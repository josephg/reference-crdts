const automerge = require('automerge')
const assert = require('assert')

const amInit = automerge.from({arr: []})

const randInt = (n) => Math.floor(Math.random() * n)

const docs = [
  automerge.merge(automerge.init('01'), amInit),
  automerge.merge(automerge.init('02'), amInit),
  automerge.merge(automerge.init('03'), amInit),
]

let nextItem = 0
const start = Date.now()

let i
for (i = 0;; i++) {
  if (Date.now() - start > 5000) break // Run for 5 seconds
  // console.log(i)
  // if (i % 100 === 0) console.log(i)

  // Generate a random operation
  const d = randInt(docs.length)
  let doc = docs[d]

  const len = doc.arr.length

  // Insert an item
  const content = ++nextItem
  const pos = randInt(len + 1)
  doc = automerge.change(doc, d => {
    d.arr.splice(pos, 0, content)
  })

  docs[d] = doc

  // Pick a pair of documents and merge them
  const a = randInt(docs.length)
  const b = randInt(docs.length)
  if (a !== b) {
    console.time(`merge ${i}`)
    docs[a] = automerge.merge(docs[a], docs[b])
    docs[b] = automerge.merge(docs[b], docs[a])
    console.timeEnd(`merge ${i}`)
    assert.deepStrictEqual(docs[a], docs[b])
  }
}

console.log(`In 5 seconds ran ${i} iterations`)