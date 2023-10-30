// import * as collabs from "@collabs/collabs";
// import {ListFugueSimple} from 'list-fugue-simple'
import {ListFugueSimple} from './list-fugue-simple.js'

// interface FugueDoc {
//   app: collabs.CRDTApp,
//   // list: CValueList<number>,
//   list: ListFugueSimple<number>,
//   insert(pos: number, content: number): void,
//   messages: Uint8Array[]
// }

// function makeDoc(agent: string): FugueDoc {
//   const app = new collabs.CRDTApp({
//     // autoTransactions: 'debugOp',
//     batchingStrategy: new collabs.ManualBatchingStrategy,
//     debugReplicaID: agent
//   })

//   const messages: Uint8Array[] = []
//   app.on('Send', (evt) => {
//     // console.log('send', evt)
//     messages.push(evt.message)
//   })
//   const list = app.registerCollab('doc', init => new ListFugueSimple<number>(init))
//   app.load(collabs.Optional.empty())

//   return {
//     app,
//     list,
//     messages,
//     // list: runtime.registerCollab('doc', init => new CValueList(init)),

//     insert(pos, content) {
//       this.list.insert(pos, content)
//       this.app.commitBatch()
//     }
//   }
// }

interface FugueDoc {
  // list: CValueList<number>,
  list: ListFugueSimple<number>,
  insert(pos: number, content: number): void,
}

function makeDoc(agent: string): FugueDoc {
  const list = new ListFugueSimple<number>(agent)

  return {
    list,
    // list: runtime.registerCollab('doc', init => new CValueList(init)),

    insert(pos, content) {
      this.list.insert(pos, content)
    }
  }
}

function merge(a: FugueDoc, b: FugueDoc) {
  a.list.mergeFrom(b.list)
  b.list.mergeFrom(a.list)
}

const docs = [makeDoc('a'), makeDoc('b'), makeDoc('c')]
const [a, b, c] = docs

b.insert(0, 10)
merge(a, b)
a.insert(1, 20)
b.insert(1, 30)
merge(a, b)


console.log(a.list.toArray())