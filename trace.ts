// This is a scratch space for running tracing code output by reference_test.ts.

import {DocPair, Mode} from './reference_test.js'
import * as sync9 from './sync9.js'

const mode: Mode = Mode.Fugue
const a = new DocPair(0, mode)
const b = new DocPair(1, mode)
const c = new DocPair(2, mode)

const merge = (a: DocPair, b: DocPair) => a.merge(b)

a.insert(0, 1)
a.insert(1, 2)
merge(a, c)
b.insert(0, 6)
c.insert(2, 7)
merge(b, a)
b.insert(2, 14)
b.algorithm.printDoc(b.sephdoc)
merge(c, b)

// console.log(sync9.get_content(c.sync9!))