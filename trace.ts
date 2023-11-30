// This is a scratch space for running tracing code output by reference_test.ts.

import {DocPair, Mode} from './reference_test.js'
import * as sync9 from './sync9.js'

const mode: Mode = Mode.Fugue
const a = new DocPair<number>(0, mode)
const b = new DocPair<number>(1, mode)
const c = new DocPair<number>(2, mode)

const merge = <T>(a: DocPair<T>, b: DocPair<T>) => a.merge(b)

a.insert(0, 1)
a.insert(1, 2)
merge(a, c)
b.insert(0, 6)
c.insert(2, 7)
merge(b, a)
b.insert(2, 14)
b.algorithm.printDoc(b.sephdoc)
merge(c, b)

// b.algorithm.printDoc(b.sephdoc)
// console.log(sync9.get_content(c.sync9!))