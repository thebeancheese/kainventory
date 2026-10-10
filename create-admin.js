
require('dotenv').config();

const bcrypt = require('bcrypt');
const { MongoClient } = require('mongodb');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const username = (await ask('Admin username: ')).trim();
  const password = await ask('Admin password (12+ characters): ');

  rl.close();

  if (!username || password.length < 12) {
    console.log('Username is required and password must be at least 12 characters.');
    return;
  }

  if (!process.env.MONGO_URI) {
    console.log('MONGO_URI is missing from .env');
    return;
  }

  const client = new MongoClient(process.env.MONGO_URI);

  try {
    await client.connect();

    const db = client.db(process.env.DB_NAME || 'dbRestaurants');
    const admins = db.collection('admins');

    await admins.createIndex({ username: 1 }, { unique: true });

    const existing = await admins.findOne({});

    if (existing) {
      console.log('An admin account already exists. No changes made.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await admins.insertOne({
      username,
      passwordHash,
      createdAt: new Date()
    });

    console.log('Admin account created successfully.');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  rl.close();
  console.error('Could not create admin account:', err.message);
  process.exitCode = 1;
});
