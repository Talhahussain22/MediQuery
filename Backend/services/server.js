const express = require('express')
const dotenv = require('dotenv')
const { MongoClient } = require('mongodb')
const cors = require('cors')
const { createMemoryCollection } = require('./memoryStore')
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args))

dotenv.config({ path: require('path').join(__dirname, '.env') })
const app = express()
app.use(cors())
app.use(express.json())

const uri = process.env.MONGO_URI
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 })
const COLLECTION = process.env.COLLECTION || 'A_Z_medidb'
let collection

const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 🔗 Connect to MongoDB, falling back to the CSV in memory if it isn't running
async function connectDB () {
  try {
    await client.connect()
    const db = client.db(process.env.DB_NAME || 'ENQUIRY')
    collection = db.collection(COLLECTION)
    if ((await collection.estimatedDocumentCount()) === 0) {
      throw new Error(`collection ${COLLECTION} is empty — run "npm run import"`)
    }
    console.log(`✅ Connected to MongoDB (${db.databaseName}.${COLLECTION})`)
  } catch (err) {
    console.warn(`⚠️  MongoDB unavailable (${err.message}); using in-memory CSV data`)
    await client.close().catch(() => {})
    collection = await createMemoryCollection(COLLECTION)
  }
}

// Public Overpass servers are often busy (HTTP 429/504), so try mirrors in turn
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
]
const SHOP_CACHE_MS = 30 * 60 * 1000
const shopCache = new Map()

async function queryOverpass (query) {
  let lastError
  for (const server of OVERPASS_SERVERS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(server, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass rejects requests without a User-Agent (HTTP 406)
          'User-Agent': 'MediQuery/1.0 (student project)'
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (err) {
      lastError = err
      console.warn(`⚠️  Overpass ${new URL(server).host} failed: ${err.message}`)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

// 🌍 Get nearby medical shops
app.post('/get_medical_shops', async (req, res) => {
  const { latitude, longitude } = req.body
  const lat = parseFloat(latitude)
  const lon = parseFloat(longitude)

  if (!lat || !lon) {
    return res.status(400).json({ error: 'Latitude and longitude required' })
  }

  const RADIUS = 10000
  const MAX_RESULTS = 40

  const query = `[out:json][timeout:25];
  (
    node["amenity"="pharmacy"](around:${RADIUS},${lat},${lon});
    node["shop"="chemist"](around:${RADIUS},${lat},${lon});
    node["shop"="drugstore"](around:${RADIUS},${lat},${lon});
  );
  out center qt ${MAX_RESULTS};`

  // cache by ~1 km grid cell so repeated map opens don't hit Overpass again
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const cached = shopCache.get(cacheKey)
  if (cached && Date.now() - cached.time < SHOP_CACHE_MS) return res.json(cached.shops)

  try {
    const data = await queryOverpass(query)
    const elements = data.elements || []

    const shops = elements.slice(0, MAX_RESULTS).map(el => ({
      id: el.id,
      name: el.tags?.name || 'Medical Shop',
      lat: el.lat,
      lon: el.lon,
      address:
        el.tags?.['addr:street'] ||
        el.tags?.['operator'] ||
        el.tags?.['addr:full'] ||
        'Address not available'
    }))

    shopCache.set(cacheKey, { time: Date.now(), shops })
    res.json(shops)
  } catch (err) {
    console.error('❌ Error fetching nearby shops:', err)
    res.status(500).json({ error: 'Failed to fetch nearby medical shops' })
  }
})

// 🔎 Suggestions endpoint
app.get('/suggestions', async (req, res) => {
  const query = req.query.q
  if (!query || query.trim() === '') return res.json([])

  try {
    const regex = new RegExp('^' + escapeRegex(query.trim()), 'i')
    const results = await collection
      .find({ name: regex })
      .limit(6)
      .project({ name: 1, _id: 0 })
      .toArray()

    res.json(results)
  } catch (err) {
    console.error('❌ Error fetching suggestions:', err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 💊 Medicine details endpoint
app.get('/medicine', async (req, res) => {
  const name = req.query.name
  if (!name || name.trim() === '')
    return res.status(400).json({ error: 'Medicine name required' })

  try {
    const projection = {
          name: 1,
          manufacturer_name: 1,
          price: 1,
          'price(₹)': 1,
          short_composition1: 1,
          short_composition2: 1,
          type: 1,
          pack_size_label: 1,
          Consolidated_Side_Effects: 1,
          use0: 1,
          use1: 1,
          use2: 1,
          use3: 1,
          use4: 1,
          substitute0: 1,
          substitute1: 1,
          substitute2: 1,
          substitute3: 1,
          substitute4: 1,
          'Habit Forming': 1,
          'Therapeutic Class': 1,
          'Prescription Required': 1
    }
    const escaped = escapeRegex(name.trim())
    // exact match first, then prefix match (substitutes are often listed by brand name only)
    const result =
      (await collection.findOne({ name: new RegExp('^' + escaped + '$', 'i') }, { projection })) ||
      (await collection.findOne({ name: new RegExp('^' + escaped + '\\b', 'i') }, { projection }))

    if (!result) return res.status(404).json({ error: 'Medicine not found' })

    if (result.price === undefined && result['price(₹)'] !== undefined) {
      result.price = result['price(₹)']
    }

    res.json(result)
  } catch (err) {
    console.error('❌ Error fetching medicine:', err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 🔗 Similar medicines endpoint
app.get('/similar', async (req, res) => {
  const { comp1, comp2 } = req.query
  if (!comp1) return res.status(400).json({ error: 'Composition required' })

  try {
    const query = { short_composition1: comp1 }
    if (comp2 && comp2.trim() !== '') query.short_composition2 = comp2

    const similarMeds = await collection
      .find(query)
      .project({
        name: 1,
        manufacturer_name: 1,
        price: 1,
        'price(₹)': 1,
        short_composition1: 1,
        short_composition2: 1
      })
      .limit(50)
      .toArray()

    const formatted = similarMeds.map(item => ({
      ...item,
      price: item.price ?? item['price(₹)']
    }))

    res.json(formatted)
  } catch (err) {
    console.error('❌ Error fetching similar medicines:', err)
    res.status(500).json({ error: 'Internal Server Error' })
  }
})

const HOST = process.env.HOST || '0.0.0.0'
const PORT = process.env.PORT || 5000

connectDB()
  .then(() => {
    app.listen(PORT, HOST, () =>
      console.log(`🚀 Server running on http://${HOST}:${PORT}`)
    )
  })
  .catch(err => {
    console.error('❌ Could not connect to MongoDB:', err.message)
    process.exit(1)
  })
