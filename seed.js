// Import the instructor's dataset only into an empty collection.
require('dotenv').config();
const { MongoClient } = require('mongodb');
const sample = require('./data/dbrestaurant.json');

(async () => {
  const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017');
  try {
    await client.connect();
    const col = client.db(process.env.DB_NAME || 'dbRestaurants')
      .collection(process.env.COLLECTION || 'restaurants');
    if (await col.countDocuments() > 0) {
      console.log('Collection already has data - nothing inserted.');
      return;
    }
    const result = await col.insertMany(sample);
    console.log('Inserted ' + result.insertedCount + ' assigned restaurants.');
  } finally {
    await client.close();
  }
})().catch((error) => {
  console.error('Import failed:', error.message);
  process.exitCode = 1;
});
