// Shared CSV helpers used by import_data.js and the in-memory fallback store
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const ROOT = path.join(__dirname, '..', '..')
const DATASETS = {
  pk: { file: 'Pakistan_medicines_dataset.csv', collection: 'PK_medidb' },
  in: { file: 'Extensive_A_Z_medicines_dataset_of_India.csv', collection: 'A_Z_medidb' }
}

// Minimal CSV parser that handles quoted fields with commas, quotes and newlines
async function * readCsv (file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })
  let header = null
  let row = []
  let field = ''
  let inQuotes = false

  for await (const line of rl) {
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++ } else if (c === '"') inQuotes = false
        else field += c
      } else if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' } else field += c
    }
    if (inQuotes) { field += '\n'; continue }
    row.push(field)
    if (!header) header = row.map(h => h.replace(/^﻿/, '').trim())
    else {
      const doc = {}
      header.forEach((h, i) => {
        const v = (row[i] ?? '').trim()
        if (v !== '') doc[h] = v
      })
      yield doc
    }
    row = []
    field = ''
  }
}

function normalize (doc) {
  for (const key of ['price', 'price(₹)']) {
    if (doc[key] !== undefined && !isNaN(parseFloat(doc[key]))) doc[key] = parseFloat(doc[key])
  }
  if (doc.id !== undefined) doc.id = parseInt(doc.id, 10)
  return doc
}

module.exports = { ROOT, DATASETS, readCsv, normalize }
