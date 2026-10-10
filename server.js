// Backend: Express server and MongoDB CRUD API
require('dotenv').config();
const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { rateLimit } = require('express-rate-limit');
// Settings (override in .env)
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'dbRestaurants';
const COLLECTION = process.env.COLLECTION || 'restaurants';

// App setup (app must exist before any route is added)
const app = express();
app.use(express.json());

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is missing from .env');
}

// Render uses a reverse proxy for HTTPS
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(session({
  name: 'kainventory.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,

  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    dbName: DB_NAME,
    collectionName: 'sessions',
    ttl: 60 * 60 * 8
  }),

  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

/* CSRF Protection */
function checkSameOrigin(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

  if (safeMethods.includes(req.method)) {
    return next();
  }

  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  const origin = req.get('origin');

  if (origin !== expectedOrigin) {
    return res.status(403).json({
      error: 'Request blocked for security reasons.'
    });
  }

  next();
}

app.use('/api', checkSameOrigin);

app.use(express.static(path.join(__dirname, 'public')));

// Collection handles, set after connecting
let restaurants;
let messages;
let admins;
// Turn an address (string or object) into text
function addressToText(address) {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return [address.building, address.street, address.zipcode].filter(Boolean).join(' ');
}

// Shape a document for the browser
function toClient(doc) {
  return {
    _id: doc._id,
    restaurant_id: doc.restaurant_id ?? '',
    name: doc.name || '',
    cuisine: doc.cuisine || '',
    address: addressToText(doc.address),
    borough: doc.borough || '',
    rating: typeof doc.rating === 'number' ? doc.rating : null,
    contact: doc.contact || '',
    createdAt: doc.createdAt || (doc._id && doc._id.getTimestamp ? doc._id.getTimestamp() : null)
  };
}

// Validate and clean form data
function cleanBody(body) {
  const name = String(body.name || '').trim();
  const cuisine = String(body.cuisine || '').trim();
  const address = String(body.address || '').trim();
  const contact = String(body.contact || '').trim();
  const ratingRaw = body.rating;

  if (!name) return { error: 'Restaurant name is required.' };
  if (!cuisine) return { error: 'Cuisine is required.' };

  let rating = null;
  if (ratingRaw !== '' && ratingRaw !== null && ratingRaw !== undefined) {
    rating = Number(ratingRaw);
    if (Number.isNaN(rating) || rating < 0 || rating > 5) {
      return { error: 'Rating must be a number from 0 to 5.' };
    }
  }
  return { value: { name, cuisine, address, rating, contact } };
}

// Next id = highest id + 1
async function nextRestaurantId() {
  const docs = await restaurants.find({}, { projection: { restaurant_id: 1 } }).toArray();
  const max = docs.reduce((m, d) => Math.max(m, parseInt(d.restaurant_id, 10) || 0), 0);
  return max + 1;
}

// Escape user text for regex search
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const validId = (id) => ObjectId.isValid(id);

/* Admin Authentication */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please try again in 15 minutes.'
  }
});

// Check login status
app.get('/api/admin/session', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    loggedIn: Boolean(req.session.adminId),
    username: req.session.username || null
  });
});

// Login
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const username = req.body?.username;
    const password = req.body?.password;

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !password ||
      username.length > 100 ||
      password.length > 256
    ) {
      return res.status(400).json({
        error: 'Please enter a valid username and password.'
      });
    }

    const admin = await admins.findOne({
      username: username.trim()
    });

    const valid = admin
      ? await bcrypt.compare(password, admin.passwordHash)
      : false;

    if (!valid) {
      return res.status(401).json({
        error: 'Invalid username or password.'
      });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({
          error: 'Could not start login session.'
        });
      }

      req.session.adminId = String(admin._id);
      req.session.username = admin.username;

      req.session.save((err) => {
        if (err) {
          return res.status(500).json({
            error: 'Could not save login session.'
          });
        }

        res.json({
          message: 'Login successful.',
          username: admin.username
        });
      });
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({
      error: 'Could not log in.'
    });
  }
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        error: 'Could not log out.'
      });
    }

    res.clearCookie('kainventory.sid', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json({
      message: 'Logged out successfully.'
    });
  });
});

// Protect admin-only operations
function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({
      error: 'Admin login required.'
    });
  }

  next();
}

// READ: cuisine list with the number of restaurants in each (MongoDB $group)
app.get('/api/cuisines', async (req, res) => {
  try {
    const data = await restaurants.aggregate([
      { $match: { cuisine: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$cuisine', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } }
    ]).toArray();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load cuisines.' });
  }
});

// READ: top 5 restaurants by rating (homepage)
app.get('/api/restaurants/top', async (req, res) => {
  try {
    const docs = await restaurants
      .find({ rating: { $type: 'number' } })
      .sort({ rating: -1, name: 1 })
      .limit(5)
      .toArray();
    res.json(docs.map(toClient));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load top restaurants.' });
  }
});

// READ: 5 most recently added restaurants (sorted by the createdAt date field)
// Older records without createdAt come after, newest _id first.
app.get('/api/restaurants/recent', async (req, res) => {
  try {
    const docs = await restaurants
      .find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .toArray();
    res.json(docs.map(toClient));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load recent restaurants.' });
  }
});

// READ: average rating per place (MongoDB aggregation: $match, $addFields, $group, $sort)
app.get('/api/stats/places', async (req, res) => {
  try {
    const data = await restaurants.aggregate([
      // Only restaurants that have a numeric rating
      { $match: { rating: { $type: 'number' } } },
      // Use address when it is text, otherwise fall back to borough
      { $addFields: {
          place: { $cond: [{ $eq: [{ $type: '$address' }, 'string'] }, '$address', '$borough'] }
      } },
      { $match: { place: { $type: 'string', $ne: '' } } },
      // One group per place: average, best rating and number of restaurants
      { $group: {
          _id: '$place',
          avgRating: { $avg: '$rating' },
          bestRating: { $max: '$rating' },
          names: { $push: '$name' },
          count: { $sum: 1 }
      } },
      { $project: { _id: 1, count: 1, bestRating: 1, names: 1, avgRating: { $round: ['$avgRating', 2] } } },
      { $sort: { avgRating: -1, count: -1, _id: 1 } },
      { $limit: 8 }
    ]).toArray();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load place stats.' });
  }
});

// READ: list with search and paging
app.get('/api/restaurants', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const search = String(req.query.search || '').trim();

    let filter = {};
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' };
      const or = [
        { name: rx }, { cuisine: rx }, { address: rx },
        { 'address.street': rx }, { borough: rx }
      ];
      if (/^\d+$/.test(search)) {
        or.push({ restaurant_id: Number(search) }, { restaurant_id: rx });
      }
      filter = { $or: or };
    }

    const total = await restaurants.countDocuments(filter);
    const docs = await restaurants.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.json({ data: docs.map(toClient), total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load restaurants.' });
  }
});

// READ: homepage stats
app.get('/api/stats', async (req, res) => {
  try {
    const total = await restaurants.countDocuments();
    const avg = await restaurants.aggregate([
      { $match: { rating: { $type: 'number' } } },
      { $group: { _id: null, avg: { $avg: '$rating' } } }
    ]).toArray();
    const cuisines = (await restaurants.distinct('cuisine')).length;
    res.json({ db: DB_NAME, total, cuisines, avgRating: avg.length ? Number(avg[0].avg.toFixed(1)) : null });
  } catch (err) {
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// CREATE: insertOne
app.post('/api/restaurants', requireAdmin, async (req, res) => {
  const { value, error } = cleanBody(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const doc = { restaurant_id: await nextRestaurantId(), ...value, createdAt: new Date() };
    const result = await restaurants.insertOne(doc);
    res.status(201).json({ message: 'Restaurant added.', _id: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add the restaurant.' });
  }
});

// UPDATE: updateOne
app.put('/api/restaurants/:id', requireAdmin, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid restaurant id.' });
  const { value, error } = cleanBody(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const result = await restaurants.updateOne({ _id: new ObjectId(req.params.id) }, { $set: value });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Restaurant not found.' });
    res.json({ message: 'Restaurant updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the restaurant.' });
  }
});

// DELETE: deleteOne
app.delete('/api/restaurants/:id', requireAdmin, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid restaurant id.' });
  try {
    const result = await restaurants.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Restaurant not found.' });
    res.json({ message: 'Restaurant deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the restaurant.' });
  }
});

// Contact form: save a message
app.post('/api/contact', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const message = String(req.body.message || '').trim();

  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (message.length < 5) return res.status(400).json({ error: 'Please write a short message.' });

  try {
    await messages.insertOne({ name, email, message: message.slice(0, 1000), createdAt: new Date() });
    res.status(201).json({ message: 'Message sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send your message.' });
  }
});

// Connect to MongoDB, then start the server
MongoClient.connect(MONGO_URI)
  .then((client) => {
    const db = client.db(DB_NAME);
    restaurants = db.collection(COLLECTION);
    messages = db.collection('messages');
    admins = db.collection('admins');
    console.log(`Connected to MongoDB: ${DB_NAME}.${COLLECTION}`);
    app.listen(PORT, () => console.log(`Kainventory running at http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed. Is MongoDB running?', err.message);
    process.exit(1);
  });