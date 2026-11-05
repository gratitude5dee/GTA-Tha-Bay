/**
 * Static tables of the art kit (M10d1): which gray-box stand-in each model replaces, which handling preset a road vehicle follows and
 * how a prop sits on its entity. The gray-box table is the inverse of the `repoint` maps of `config/art-placeholders.json` (a unit test
 * keeps the two equal).
 */

/** The gray-box stand-in each art ref replaces. */
export const ART_GRAYBOX: Readonly<Record<string, string>> = {
  'vehicle/traffic.compact': 'vehicle/graybox.compact',
  'vehicle/traffic.sedan': 'vehicle/graybox.sedan',
  'vehicle/traffic.rideshare': 'vehicle/graybox.rideshare',
  'vehicle/traffic.van': 'vehicle/graybox.van',
  'vehicle/traffic.truck': 'vehicle/graybox.truck',
  'vehicle/traffic.pickup': 'vehicle/graybox.pickup',
  'vehicle/robotaxi.default': 'vehicle/graybox.robotaxi',
  'vehicle/police.cruiser': 'vehicle/graybox.cruiser',
  'vehicle/police.suv': 'vehicle/graybox.suv',
  'vehicle/transit.bus': 'vehicle/graybox.bus',
  'vehicle/transit.cablecar': 'vehicle/graybox.cablecar',
  'prop/police.heli': 'vehicle/graybox.heli',
  'prop/transit.ferry': 'vehicle/graybox.ferry',
  'prop/transit.airliner': 'vehicle/graybox.airliner',
  'prop/cone': 'prop/graybox.cone',
  'prop/barrier': 'prop/graybox.barrier',
  'prop/county-barrier': 'prop/graybox.county-barrier',
  'prop/spikestrip': 'prop/graybox.spikestrip',
  'prop/crate': 'prop/graybox.crate',
  'prop/transit-entrance': 'prop/graybox.transit-entrance',
  'prop/portal-closure': 'prop/graybox.portal-closure',
  'prop/pickup-cash': 'prop/graybox.pickup-cash',
  'prop/pickup-item': 'prop/graybox.pickup-item',
  'prop/marker.beam': 'prop/graybox.beam',
};

/** The road vehicles of the pool: handling preset (wheel size, wheelbase, centre of gravity) and the overall size of the footprint. */
export const ART_VEHICLES: Readonly<Record<string, { hp: string; length: number; width: number; height: number }>> = {
  'vehicle/traffic.compact': { hp: 'hp.compact', length: 3.7, width: 1.7, height: 1.47 },
  'vehicle/traffic.sedan': { hp: 'hp.sedan', length: 4.7, width: 1.85, height: 1.5 },
  'vehicle/traffic.rideshare': { hp: 'hp.rideshare', length: 4.6, width: 1.85, height: 1.52 },
  'vehicle/traffic.van': { hp: 'hp.van', length: 5.4, width: 2.0, height: 2.1 },
  'vehicle/traffic.truck': { hp: 'hp.truck', length: 6.5, width: 2.3, height: 3.0 },
  'vehicle/traffic.pickup': { hp: 'hp.pickup', length: 5.3, width: 2.0, height: 1.72 },
  'vehicle/robotaxi.default': { hp: 'hp.robotaxi-ambient', length: 4.8, width: 1.95, height: 1.56 },
  'vehicle/police.cruiser': { hp: 'hp.police-cruiser', length: 5.0, width: 1.9, height: 1.5 },
  'vehicle/police.suv': { hp: 'hp.police-suv', length: 4.9, width: 2.0, height: 1.82 },
};

/**
 * How a prop's model sits on the entity position: `centre` the middle of its bounds (a physics box centred on the position, as the
 * gray-box shapes were), `origin` as authored (the beam stands on the position; the helicopter is modelled about its centre).
 */
export const ART_ANCHOR: Readonly<Record<string, 'centre' | 'origin'>> = {
  'prop/marker.beam': 'origin',
  'prop/police.heli': 'origin',
};

/** The gray-box key a ref stands in for, or the ref itself. */
export const grayboxOf = (ref: string): string => ART_GRAYBOX[ref] ?? ref;
