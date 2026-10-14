// Fallback when MongoDB isn't available: loads the dataset CSV into memory and
// supports the small subset of the collection API that server.js uses.
const fs = require('fs')
const path = require('path')
const { ROOT, DATASETS, readCsv, normalize } = require('./csv')

function matches (doc, query) {
  return Object.entries(query).every(([key, cond]) => {
    const value = doc[key]
    if (cond instanceof RegExp) return value !== undefined && cond.test(String(value))
    return value === cond
  })
}

function applyProjection (doc, projection) {
  if (!projection) return { ...doc }
  const out = {}
  for (const [key, include] of Object.entries(projection)) {
    if (include && doc[key] !== undefined) out[key] = doc[key]
  }
  return out
}

class Cursor {
  constructor (docs, query) {
    this.docs = docs
    this.query = query
    this.max = Infinity
    this.proj = null
  }

  limit (n) { this.max = n; return this }
  project (p) { this.proj = p; return this }

  async toArray () {
    const out = []
    for (const doc of this.docs) {
      if (out.length >= this.max) break
      if (matches(doc, this.query)) out.push(applyProjection(doc, this.proj))
    }
    return out
  }
}

async function loadDocs (file) {
  const docs = []
  for await (const doc of readCsv(file)) docs.push(normalize(doc))
  return docs
}

async function createMemoryCollection (collectionName) {
  const ds = Object.values(DATASETS).find(d => d.collection === collectionName)
  if (!ds) throw new Error(`No CSV mapped to collection "${collectionName}"`)
  const file = path.join(ROOT, ds.file)
  let docs = await loadDocs(file)
  console.log(`📄 Loaded ${docs.length} medicines from ${ds.file} (in-memory mode)`)

  // The scraper rewrites the CSV as it collects more medicines; pick that up
  // without a restart.
  fs.watchFile(file, { interval: 30000 }, async (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return
    try {
      docs = await loadDocs(file)
      console.log(`🔄 Reloaded ${docs.length} medicines from ${ds.file}`)
    } catch (err) {
      console.warn(`⚠️  Reload of ${ds.file} failed: ${err.message}`)
    }
  })

  return {
    find: query => new Cursor(docs, query),
    findOne: async (query, { projection } = {}) => {
      const doc = docs.find(d => matches(d, query))
      return doc ? applyProjection(doc, projection) : null
    }
  }
}

module.exports = { createMemoryCollection }
