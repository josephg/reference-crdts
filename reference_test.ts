// This file contains a fuzzer which checks these implementations vs the
// real implementations in yjs and automerge.

import * as Y from 'yjs'
import * as automerge from '@automerge/automerge'
import assert from 'assert/strict'
import seed from 'seed-random'
import consoleLib from 'console'
import * as crdts from './crdts.js'
import * as sync9 from './sync9.js'

// For fugue.
import { ListFugueSimple } from './list-fugue-simple.js'

type DocType = {arr: number[]}

const amInit = automerge.from<DocType>({arr: []})

export enum Mode {
  Automerge,
  Yjs,
  YjsMod,
  Sync9,
  Fugue,
}

let log = ''

type FugueMessage = { src: string, msg: Uint8Array }

export class DocPair {
  id: number
  idStr: string

  algorithm: crdts.Algorithm
  sephdoc: crdts.Doc<number>

  am?: automerge.Doc<DocType>
  ydoc?: Y.Doc
  sync9?: any
  // fugue?: {
  //   // app: collabs.CRDTApp,
  //   list: ListFugueSimple<number>,
  //   messages: FugueMessage[],
  // }
  fugue?: ListFugueSimple<number>

  constructor(id: number, localMode: Mode, checkMode: Mode | null = localMode) {
    this.id = id
    this.idStr = 'abc'[id]

    this.algorithm = {
      [Mode.Automerge]: crdts.automerge,
      [Mode.Yjs]: crdts.yjs,
      [Mode.YjsMod]: crdts.yjsMod,
      [Mode.Fugue]: crdts.fugue,
      [Mode.Sync9]: crdts.sync9,
    }[localMode]
    if (this.algorithm == null) throw Error('Unknown algorithm: ' + localMode)

    this.sephdoc = crdts.newDoc()

    // this.am = automerge.from<DocType>({arr: []}, idStr)
    // this.am = automerge.from<DocType>(amInit, idStr)
    switch (checkMode) {
      case Mode.Automerge: {
        // Automerge client ID strings must be valid hex strings, and the
        // concurrent item ordering is reversed from my algorithms here.
        // (So I'm inversing their order here).
        const amId = Buffer.from([255 - id]).toString('hex')
        this.am = automerge.merge(automerge.init(amId), amInit)
        break
      }
      case Mode.Yjs: {
        this.ydoc = new Y.Doc()
        this.ydoc.clientID = id
        break
      }
      case Mode.Sync9: {
        this.sync9 = sync9.make(this.idStr)
        break
      }
      case Mode.Fugue: {
        this.fugue = new ListFugueSimple(this.idStr)
        break
      }
    }
  }

  // ins(pos: number, content: number[]) {
  insert(pos: number, content: number) {
    // assert(content.length === 1)
    this.algorithm.localInsert(this.sephdoc, this.idStr, pos, content)
    // console.log('->ins', pos, content, this.sephdoc)

    this.ydoc?.getArray().insert(pos, [content])

    if (this.am != null) {
      this.am = automerge.change(this.am, d => {
        d.arr.splice(pos, 0, content)
      })
    }

    if (this.sync9 != null) {
      sync9.insert(this.sync9, pos, content)
    }

    if (this.fugue != null) {
      // if (content === 31 || content === 35) debugger
      this.fugue.insert(pos, content)
      // this.fugue.app.commitBatch()

      // console.log('insert', 'pos', pos, 'content', content, 'agent', this.idStr)
      // const fugueList = this.fugue.list.slice()
      // console.log('fugue', fugueList)
      // for (let i = 0; i < fugueList.length; i++) {
      //   console.log(`  ${i}: ${fugueList[i]}   pos: ${this.fugue.list.getPosition(i)}`)
      // }
      // this.fugue.list.list.printTreeWalk()
    }
  }

  del(pos: number) {
    // I haven't added delete support to the merge() function in crdts.
    throw Error('NYI')

    // crdts.localDelete(this.sephdoc, this.idStr, pos)

    // this.ydoc?.getArray().delete(pos, 1)

    // if (this.am != null) {
    //   this.am = automerge.change(this.am, d => {
    //     d.arr.splice(pos, 1)
    //   })
    // }

    // if (this.sync9) throw Error('nyi')
  }

  mergeFrom(other: DocPair) {
    // console.log('merging', other.content, 'into', this.content)

    crdts.mergeInto(this.algorithm, this.sephdoc, other.sephdoc)

    if (this.am != null) {
      this.am = automerge.merge(this.am, other.am!)
      // console.log('am', this.am.arr)
      // console.log('hist', automerge.getHistory(this.am).map(e => e.change))
      // console.log('am', other.am, this.am)
    }

    if (this.ydoc != null) {
      const sv = Y.encodeStateVector(this.ydoc)
      // console.log('sv', sv)
      const update = Y.encodeStateAsUpdateV2(other.ydoc!, sv)
      // Y.logUpdateV2(update)
      Y.applyUpdateV2(this.ydoc, update)

      // Y.logUpdateV2(Y.encodeStateAsUpdateV2(other.ydoc))
      // Y.logUpdateV2(Y.encodeStateAsUpdateV2(this.ydoc))
      // console.log('y', other.yarr.toArray(), this.ydoc?.getArray().toArray())
      // console.log('am now', this.am)
      // console.log('yjs now', this.ydoc?.getArray().toArray())
    }

    if (this.sync9 != null) {
      this.sync9 = sync9.merge(this.sync9, other.sync9)
    }

    if (this.fugue != null) {
      this.fugue.mergeFrom(other.fugue!)
      // for (const m of other.fugue!.messages) {
      //   if (m.src !== this.idStr) {
      //     this.fugue.app.receive(m.msg)
      //     this.fugue.messages.push(m)
      //   }
      // }

      // const data = other.fugue!.runtime.save()
      // this.fugue.runtime.load(data)
    }

    this.check()
    // console.log('->', this.content)
  }

  merge(other: DocPair) {
    this.mergeFrom(other)
    other.mergeFrom(this)
    this.checkEq(other)
  }

  check() {
    const myContent = crdts.getArray(this.sephdoc)
    // console.log('am', this.sephdoc.content)
    if (this.am != null) {
      assert.deepStrictEqual(myContent, this.am.arr)
    }

    if (this.ydoc != null) {
      // assert.equal(this.am.arr.length, this.ydoc?.getArray().length)
      // assert.deepEqual(this.am.arr, this.ydoc?.getArray().toArray())
      assert.deepStrictEqual(myContent, this.ydoc.getArray().toArray())
    }

    if (this.sync9 != null) {
      try {
        // console.log(this.sephdoc)
        assert.deepStrictEqual(myContent, sync9.get_content(this.sync9))
      } catch (e) {
        console.log('am', this.sephdoc.content)
        console.log(log)
        this.algorithm.printDoc(this.sephdoc)
        throw e
      }
    }

    if (this.fugue != null) {
      const fugueList = this.fugue.toArray()
      try {
        assert.deepStrictEqual(myContent, fugueList)
      } catch (e) {
        // console.log('fugue waypoints', this.fugue!.list.totalOrder.rootWaypoint)
        console.log('doc', this.idStr)
        console.log('local', this.sephdoc.content)

        console.log('fugue', fugueList)
        // for (let i = 0; i < fugueList.length; i++) {
        //   console.log(`  ${i}: ${fugueList[i]}   pos: ${this.fugue.list.getPosition(i)}`)
        // }
        // this.fugue.list.list.printTreeWalk()
        // for (let i = 0; i < fugueList.length; i++) {
        //   console.log(fugueList[i], this.fugue.list.totalOrder.decode(this.fugue.list.getPosition(i)))
        // }
        this.algorithm.printDoc(this.sephdoc)
        console.log('\n---fugue---')
        this.fugue.debugPrint()
        console.log(log)
        throw e
      }
    }

    // console.log('result', this.ydoc?.getArray().toArray())
  }

  checkEq(other: DocPair) {
    // console.log('x', this.fugue?.list.slice())
    // console.log('y', other.fugue?.list.slice())
    this.check()
    other.check()
    assert.deepEqual(this.content, other.content)
  }

  get content(): number[] {
    return this.am != null
      ? this.am!.arr
      : crdts.getArray(this.sephdoc)
  }

  get length(): number {
    // return this.am.arr.length
    return this.sephdoc.content.reduce((sum, item) => item.isDeleted || item.content == null ? sum : sum + 1, 0)
  }
}

const randomizer = (localMode: Mode, checkMode: (Mode | null) = localMode) => {
  globalThis.console = new consoleLib.Console({
    stdout: process.stdout, stderr: process.stderr,
    inspectOptions: {depth: null}
  })

  const systemSeed = process.env['SEED'] ?? ''

  // for (let iter = 0; iter < 1000; iter++) {
  for (let iter = 0; ; iter++) {
    if (iter % 20 === 0) console.log('iter', iter)
    // console.log('iter', iter)
    // const random = seed(`bb ${iter}`)
    const random = seed(`${systemSeed} ${iter}`)
    const randInt = (n: number) => Math.floor(random() * n)
    const randBool = (weight: number = 0.5) => random() < weight

    const docs = new Array(3).fill(null).map((_, i) => new DocPair(i, localMode, checkMode))
    // const docs = new Array(1).fill(null).map((_, i) => new DocPair(i, mode))

    log = ''

    const randDoc = () => docs[randInt(docs.length)]

    let nextItem = 0
    // console.log(docs)
    for (let i = 0; i < 100; i++) {
      // console.log(i)
      // if (iter === 8 && i === 5) debugger
      // if (i % 100 === 0) console.log(i)

      // Generate some random operations
      for (let j = 0; j < 3; j++) {
      // for (let j = 0; j < 1; j++) {
        const doc = randDoc()

        // console.log('old content for doc', doc.id, doc.content)

        const len = doc.length
        // const insWeight = 1
        const insWeight = len < 100 ? 0.65 : 0.35
        // if (len === 0 || randBool(insWeight)) {
        if (true) {
          // Insert!
          // const content = new Array(randInt(3) + 1).fill(null).map(() => ++nextItem)
          const content = ++nextItem
          const pos = randInt(len + 1)
          // console.log('insert', pos, content)
          doc.insert(pos, content)
          log += `${doc.idStr}.insert(${pos}, ${content})\n`
        } else {
          // Delete something
          const pos = randInt(len)
          // const span = randInt(Math.min(len - pos, 3)) + 1
          // console.log('del', pos, span)
          doc.del(pos)
        }
        doc.check()
        // console.log('new content for doc', doc.id, doc.content)
      }

      // Pick a pair of documents and merge them
      const a = randDoc()
      const b = randDoc()
      if (a !== b) {
        // console.log('merging', a.id, b.id, a.content, b.content)
        log += `merge(${a.idStr}, ${b.idStr})\n`
        a.merge(b)
      }
    }
  }
}

function runRandomizer() {
  // randomizer(Mode.YjsMod, Mode.Sync9)
  // randomizer(Mode.Automerge)
  // randomizer(Mode.Sync9, Mode.Fugue)
  // randomizer(Mode.Sync9)
  // randomizer(Mode.Sync9, Mode.Fugue)
  randomizer(Mode.Fugue)
  // randomizer(Mode.YjsMod, Mode.Fugue)
  // console.log('iters', crdts.iters)

  // const docs = [new DocPair(0, Mode.Fugue), new DocPair(1, Mode.Fugue), new DocPair(2, Mode.Fugue)]
  // const [a, b, c] = docs

  // const merge = (a: DocPair, b: DocPair) => { a.merge(b) }

  // b.insert(0, 10)
  // merge(a, b)
  // a.insert(1, 20)
  // b.insert(1, 30)
  // merge(a, b)
}

runRandomizer()
