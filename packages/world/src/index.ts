// @dv/world: the streamed city. `./sim` is pure sim code (C02 lint; no three, no DOM) and is what sim.worker imports; `./client` is
// the page half (three, the mesher, the chunk renderer, the backdrop). Import the half you need through its subpath.
export * from './sim/index.ts';
