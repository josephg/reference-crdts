import zlib from 'zlib'
import fs from 'fs'
import {Algorithm, newDoc, localInsert, localDelete, yjsMod, automerge} from './crdts'

const bench = (alg: Algorithm) => {
  // const filename = 'sveltecomponent'
  const filename = 'automerge-paper'
  const {
    startContent,
    endContent,
    txns
  } = JSON.parse(zlib.gunzipSync(fs.readFileSync(`../crdt-benchmarks/${filename}.json.gz`)).toString())

  console.time(filename)
  const doc = newDoc()

  for (const txn of txns) {
    for (const patch of txn.patches) {
      // Ignoring any deletes for now.
      const [pos, delCount, inserted] = patch as [number, number, string]
      if (inserted.length) {
        localInsert(alg, doc, 'A', pos, inserted)
      } else if (delCount) {
        localDelete(doc, 'A', pos)
      }
    }
  }
  console.timeEnd(filename)
}

bench(yjsMod)
bench(automerge)
