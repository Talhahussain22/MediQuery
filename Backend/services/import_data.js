// Imports the medicine CSVs into local MongoDB.
//   node services/import_data.js          -> imports Pakistani + Indian datasets
//   node services/import_data.js pk       -> only Pakistani dataset
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
const { MongoClient } = require('mongodb')

dotenv.config({ path: path.join(__dirname, '.env') })

const { ROOT, DATASETS, readCsv, normalize } = require('./csv')

async function importDataset (db, { file, collection }) {
  const fullPath = path.join(ROOT, file)
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  ${file} not found, skipping`)
    return
  }
  const col = db.collection(collection)
  await col.deleteMany({})
  let batch = []
  let count = 0
  for await (const doc of readCsv(fullPath)) {
    batch.push(normalize(doc))
    if (batch.length === 5000) {
      await col.insertMany(batch)
      count += batch.length
      batch = []
      process.stdout.write(`\r${collection}: ${count}`)
    }
  }
  if (batch.length) {
    await col.insertMany(batch)
    count += batch.length
  }
  await col.createIndex({ name: 1 })
  await col.createIndex({ short_composition1: 1, short_composition2: 1 })
  console.log(`\r✅ ${collection}: ${count} medicines imported from ${file}`)
}

async function main () {
  const which = process.argv[2]
  const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017')
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'ENQUIRY')
  for (const [key, ds] of Object.entries(DATASETS)) {
    if (!which || which === key) await importDataset(db, ds)
  }
  await client.close()
}

main().catch(err => {
  console.error('❌ Import failed:', err.message)
  process.exit(1)
})
