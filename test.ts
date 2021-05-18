import assert from 'assert'
import seed from 'seed-random'
import {Item, Algorithm, newDoc, canInsertNow, getArray, makeItem, mergeInto, localDelete, Doc, yjsMod, automerge, yjs, printDebugStats, sync9} from './crdts'

/// TESTS

const runTests = (algName: string, alg: Algorithm) => { // Separate scope for namespace protection.
  const random = seed('ax')
  const randInt = (n: number) => Math.floor(random() * n)
  const randArrItem = (arr: any[] | string) => arr[randInt(arr.length)]
  const randBool = (weight: number = 0.5) => random() < weight

  const integrateFuzzOnce = <T>(ops: Item<T>[], expectedResult: T[]): number => {
    let variants = 1
    const doc = newDoc()

    // Scan ops looking for candidates to integrate
    for (let numIntegrated = 0; numIntegrated < ops.length; numIntegrated++) {
      const candidates = []
      for (const op of ops) {
        if (canInsertNow(op, doc)) {
          candidates.push(op)
        }
      }

      assert(candidates.length > 0)
      variants *= candidates.length
      // console.log('doc version', doc.version, 'candidates', candidates)

      // Pick one
      const op = candidates[randInt(candidates.length)]
      // console.log(op, doc.version)
      alg.integrate(doc, op)
    }

    // alg.printDoc(doc)

    try {
      assert.deepStrictEqual(getArray(doc), expectedResult)
    } catch(e) {
      console.log()
      alg.printDoc(doc)
      throw e
    }
    // console.log(variants)
    return variants // Rough guess at the number of orderings
  }


  const integrateFuzz = <T>(ops: Item<T>[], expectedResult: T[]) => {
    // Integrate the passed items a bunch of times, in different orders.
    let variants = integrateFuzzOnce(ops, expectedResult)
    for (let i = 1; i < Math.min(variants * 3, 100); i++) {
      let newVariants = integrateFuzzOnce(ops, expectedResult)
      variants = Math.max(variants, newVariants)
    }
  }

  const test = (fn: () => void) => {
    if (alg.ignoreTests && alg.ignoreTests.includes(fn.name)) {
      process.stdout.write(`SKIPPING ${fn.name}\n`)
    } else {
      process.stdout.write(`running ${fn.name} ...`)
      try {
        fn()
        process.stdout.write(`PASS\n`)
      } catch (e) {
        process.stdout.write(`FAIL:\n`)
        console.log(e.stack)
      }
    }
  }

  const smoke = () => {
    const doc = newDoc()
    alg.integrate(doc, makeItem('a', ['A', 0], null, null, 0))
    alg.integrate(doc, makeItem('b', ['A', 1], ['A', 0], null, 1))

    assert.deepStrictEqual(getArray(doc), ['a', 'b'])
  }

  const smokeMerge = () => {
    const doc = newDoc()
    alg.integrate(doc, makeItem('a', ['A', 0], null, null, 0))
    alg.integrate(doc, makeItem('b', ['A', 1], ['A', 0], null, 1))

    const doc2 = newDoc()
    mergeInto(alg, doc2, doc)
    assert.deepStrictEqual(getArray(doc2), ['a', 'b'])
  }

  const concurrentAvsB = () => {
    const a = makeItem('a', 'A', null, null, 0)
    const b = makeItem('b', 'B', null, null, 0)
    integrateFuzz([a, b], ['a', 'b'])
  }

  const interleavingForward = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a', ['A', 1], ['A', 0], null, 1),
      makeItem('a', ['A', 2], ['A', 1], null, 2),

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b', ['B', 1], ['B', 0], null, 1),
      makeItem('b', ['B', 2], ['B', 1], null, 2),
    ]

    integrateFuzz(ops, ['a', 'a', 'a', 'b', 'b', 'b'])
  }

  // Other variant with changed object IDs. The order should not be
  // dependent on the IDs of these items. I'd love to find a better way
  // to test this.
  const interleavingForward2 = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a', ['X', 0], ['A', 0], null, 1),
      makeItem('a', ['Y', 0], ['X', 0], null, 2),

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b', ['C', 0], ['B', 0], null, 1),
      makeItem('b', ['D', 0], ['C', 0], null, 2),
    ]

    integrateFuzz(ops, ['a', 'a', 'a', 'b', 'b', 'b'])
  }

  const interleavingBackward = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a', ['A', 1], null, ['A', 0], 1),
      makeItem('a', ['A', 2], null, ['A', 1], 2),

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b', ['B', 1], null, ['B', 0], 1),
      makeItem('b', ['B', 2], null, ['B', 1], 2),
    ]

    integrateFuzz(ops, ['a', 'a', 'a', 'b', 'b', 'b'])
  }

  const interleavingBackward2 = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a', ['X', 0], null, ['A', 0], 1),

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b', ['B', 1], null, ['B', 0], 1),
    ]

    integrateFuzz(ops, ['a', 'a', 'b', 'b'])
  }

  const interleavingBackwardSync9 = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a', ['X', 0], ['A', 0, false], ['A', 0], 1),

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b', ['B', 1], ['B', 0, false], ['B', 0], 1),
    ]

    integrateFuzz(ops, ['a', 'a', 'b', 'b'])
  }

  const withTails = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a0', ['A', 1], null, ['A', 0], 1), // left
      makeItem('a1', ['A', 2], ['A', 0], null, 2), // right

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b0', ['B', 1], null, ['B', 0], 1), // left
      makeItem('b1', ['B', 2], ['B', 0], null, 2), // right
    ]

    integrateFuzz(ops, ['a0', 'a', 'a1', 'b0', 'b', 'b1'])
  }

  const withTails2 = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a0', ['A', 1], null, ['A', 0], 1), // left
      makeItem('a1', ['A', 2], ['A', 0], null, 2), // right

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b0', ['1', 0], null, ['B', 0], 1), // left
      makeItem('b1', ['B', 1], ['B', 0], null, 2), // right
    ]

    integrateFuzz(ops, ['a0', 'a', 'a1', 'b0', 'b', 'b1'])
  }

  const withTails2Sync9 = () => {
    const ops = [
      makeItem('a', ['A', 0], null, null, 0),
      makeItem('a0', ['A', 1], ['A', 0, false], ['A', 0], 1), // left
      makeItem('a1', ['A', 2], ['A', 0, true], null, 2), // right

      makeItem('b', ['B', 0], null, null, 0),
      makeItem('b0', ['1', 0], ['B', 0, false], ['B', 0], 1), // left
      makeItem('b1', ['B', 1], ['B', 0], null, 2), // right
    ]

    integrateFuzz(ops, ['a0', 'a', 'a1', 'b0', 'b', 'b1'])
  }

  const localVsConcurrent = () => {
    // Check what happens when a top level concurrent change interacts
    // with a more localised change. (C vs D)
    const a = makeItem('a', 'A', null, null, 0)
    const c = makeItem('c', 'C', null, null, 0)

    // How do these two get ordered?
    const b = makeItem('b', 'B', null, null, 0) // Concurrent with a and c
    const d = makeItem('d', 'D', ['A', 0], ['C', 0], 1) // in between a and c

    // [a, b, d, c] would also be acceptable.
    integrateFuzz([a, b, c, d], ['a', 'd', 'b', 'c'])
  }

  const fuzzer1 = () => {
    const ops = [
      makeItem(3, ['0', 0], null, null, 0),
      makeItem(5, ['1', 0], null, null, 0),
      makeItem(9, ['1', 1], null, ['1', 0], 1),
      makeItem(1, ['2', 0], null, null, 0),
      makeItem(4, ['2', 1], ['0', 0], ['2', 0], 1),

      makeItem(10, ['1', 2], ['2', 1], ['1', 1], 2),
      makeItem(7, ['2', 2], ['2', 1], ['2', 0], 2),
    ]

    const doc = newDoc<number>()
    ops.forEach(op => alg.integrate(doc, op))
    console.log(getArray(doc))
  }

  const fuzzSequential = () => {
    const doc = newDoc()
    let expectedContent: string[] = []
    const alphabet = 'xyz123'
    const agents = 'ABCDE'
    let nextContent = 1

    for (let i = 0; i < 1000; i++) {
      // console.log(i)
      // console.log(doc)
      if (doc.length === 0 || randBool(0.5)) {
        // insert
        const pos = randInt(doc.length + 1)
        // const content: string = randArrItem(alphabet)
        const content = ''+nextContent++
        const agent = randArrItem(agents)
        // console.log('insert', agent, pos, `'${content}'`)
        alg.localInsert(doc, agent, pos, content)
        expectedContent.splice(pos, 0, content)
      } else {
        // Delete
        const pos = randInt(doc.length)
        const agent = randArrItem(agents)
        // console.log('delete', pos)
        localDelete(doc, agent, pos)
        expectedContent.splice(pos, 1)
      }
      // console.log('->', doc)

      // alg.printDoc(doc)
      assert.deepStrictEqual(doc.length, expectedContent.length)
      assert.deepStrictEqual(getArray(doc), expectedContent)
    }
  }

  const fuzzMultidoc = () => {
    const agents = ['A', 'B', 'C']
    for (let j = 0; j < 10; j++) {
      process.stdout.write('.')
      const docs = new Array(3).fill(null).map((_, i) => {
        const doc: Doc<number> & {agent: string} = newDoc() as any
        doc.agent = agents[i]
        return doc
      })

      const randDoc = () => docs[randInt(docs.length)]

      let nextItem = 0
      // console.log(docs)
      for (let i = 0; i < 1000; i++) {
        // console.log(i)
        // if (i % 100 === 0) console.log(i)

        // Generate some random operations
        for (let j = 0; j < 3; j++) {
          const doc = randDoc()

          // if (doc.length === 0 || randBool(0.5)) {
          if (true) {
            // insert
            const pos = randInt(doc.length + 1)
            const content = ++nextItem
            // console.log('insert', agent, pos, content)
            alg.localInsert(doc, doc.agent, pos, content)
          } else {
            // Delete - disabled for now because mergeInto doesn't support deletes
            const pos = randInt(doc.length)
            // console.log('delete', pos)
            localDelete(doc, doc.agent, pos)
          }
        }

        // Pick a pair of documents and merge them
        const a = randDoc()
        const b = randDoc()
        if (a !== b) {
          // console.log('merging', a.id, b.id, a.content, b.content)
          mergeInto(alg, a, b)
          mergeInto(alg, b, a)
          assert.deepStrictEqual(getArray(a), getArray(b))
        }
      }
    }
  }


  console.log(`--- Running tests for ${algName} ---`)
  const tests = [
    smoke,
    smokeMerge,
    concurrentAvsB,
    interleavingForward,
    interleavingForward2,
    interleavingBackward,
    interleavingBackward2,
    withTails,
    withTails2,
    localVsConcurrent,
    fuzzSequential,
    fuzzMultidoc
  ]
  tests.forEach(test)
  // interleavingBackwardSync9()
  // withTails2()
  // withTails2Sync9()
  // fuzzSequential()
  // fuzzMultidoc()
  // fuzzer1()
}

runTests('yjsmod', yjsMod)
runTests('yjs', yjs)
runTests('automerge', automerge)

// For sync9 the IDs hardcoded in these tests are misleading.
// runTests('sync9', sync9)

// console.log('hits', hits, 'misses', misses)

printDebugStats()