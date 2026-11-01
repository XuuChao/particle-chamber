// World-space glass planes, shared by the enclosure and particle simulation.
export const CABINET = Object.freeze({
  halfWidth: 1.6, halfDepth: 1.325, bottom: -1.55, top: 1.93,
  clearance: .035,
});
export const CHAMBER_ORIGIN = Object.freeze([0,.2,0]);
export const PARTICLE_MIN = Object.freeze([
  -CABINET.halfWidth+CABINET.clearance,
  CABINET.bottom+CABINET.clearance-CHAMBER_ORIGIN[1],
  -CABINET.halfDepth+CABINET.clearance,
]);
export const PARTICLE_MAX = Object.freeze([
  CABINET.halfWidth-CABINET.clearance,
  CABINET.top-CABINET.clearance-CHAMBER_ORIGIN[1],
  CABINET.halfDepth-CABINET.clearance,
]);
