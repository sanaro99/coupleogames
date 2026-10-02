import {
  CatmullRomCurve3, CircleGeometry, DataTexture, ExtrudeGeometry,
  MeshBasicMaterial, MeshStandardMaterial, Shape, ShapeGeometry, SphereGeometry,
  TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One set of small, shared meshes per companion. No fur simulation or image assets.
export function createKittenModel() {
  // A tiny static bump map gives the coat a soft grain without drawing hairs.
  const grain = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) {
    const value = 112 + ((Math.imul(i + 1, 2654435761) >>> 24) % 32);
    grain.set([value, value, value, 255], i * 4);
  }
  const coatTexture = new DataTexture(grain, 64, 64);
  coatTexture.needsUpdate = true;
  const earOutline = new Shape();
  earOutline.moveTo(-.17, -.13);
  earOutline.quadraticCurveTo(-.16, .04, -.045, .285);
  earOutline.quadraticCurveTo(-.018, .325, .018, .286);
  earOutline.quadraticCurveTo(.15, .075, .17, -.13);
  earOutline.quadraticCurveTo(0, -.19, -.17, -.13);
  const ear = new ExtrudeGeometry(earOutline, {
    depth: .055, bevelEnabled: true, bevelThickness: .025,
    bevelSize: .025, bevelSegments: 2, curveSegments: 5, steps: 1,
  });
  ear.translate(0, 0, -.045);

  const noseOutline = new Shape();
  noseOutline.moveTo(-.032, .012);
  noseOutline.quadraticCurveTo(0, .025, .032, .012);
  noseOutline.quadraticCurveTo(.035, .001, .008, -.017);
  noseOutline.quadraticCurveTo(0, -.025, -.008, -.017);
  noseOutline.quadraticCurveTo(-.035, .001, -.032, .012);

  const curve = (points: number[][], radius: number, segments = 5) => new TubeGeometry(
    new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z))), segments, radius, 4, false,
  );
  const whiskerParts = [-1, 1].flatMap(side => [-1, 0, 1].map(row => curve([
    [side * .12, -.126 + row * .012, .36],
    [side * .25, -.12 + row * .027, .365],
    [side * .39, -.12 + row * .048, .30],
  ], .0025)));
  const whiskers = mergeGeometries(whiskerParts)!;
  whiskerParts.forEach(part => part.dispose());
  const mouthParts = [
    curve([[0, -.14, .394], [0, -.165, .395]], .003),
    ...[-1, 1].map(side => curve([[0, -.165, .395], [side * .025, -.178, .39], [side * .052, -.17, .38]], .003)),
  ];
  const mouth = mergeGeometries(mouthParts)!;
  mouthParts.forEach(part => part.dispose());

  const geometry = {
    sphere: new SphereGeometry(1, 20, 14), ear,
    innerEar: new ShapeGeometry(earOutline, 5),
    nose: new ShapeGeometry(noseOutline, 6), whiskers, mouth,
    closedEye: curve([[-.098, 0, .035], [0, -.022, .063], [.098, 0, .035]], .007),
    tail: curve([[0, 0, 0], [.18, .24, -.04], [.24, .53, -.07],
      [.19, .74, -.05], [.035, .79, 0], [-.035, .71, .035]], .058, 16),
    shadow: new CircleGeometry(1, 24),
  };
  const material = {
    coat: new MeshStandardMaterial({ color: '#27262b', roughness: .84, bumpMap: coatTexture, bumpScale: .012 }),
    muzzle: new MeshStandardMaterial({ color: '#343238', roughness: .94 }),
    innerEar: new MeshStandardMaterial({ color: '#9b706c', roughness: .96 }),
    nose: new MeshStandardMaterial({ color: '#c49083', roughness: .8 }),
    iris: new MeshStandardMaterial({ color: '#b9ce7c', roughness: .42 }),
    irisInner: new MeshStandardMaterial({ color: '#71834e', roughness: .45 }),
    pupil: new MeshBasicMaterial({ color: '#101613' }),
    glint: new MeshBasicMaterial({ color: '#fffbed' }),
    whisker: new MeshBasicMaterial({ color: '#8c8e87', transparent: true, opacity: .72 }),
    mouth: new MeshBasicMaterial({ color: '#101315' }),
    closedEye: new MeshBasicMaterial({ color: '#727579' }),
    shadow: new MeshBasicMaterial({ color: '#30332b', transparent: true, opacity: .13, depthWrite: false }),
  };
  return { geometry, material, dispose() {
    Object.values(geometry).forEach(item => item.dispose());
    Object.values(material).forEach(item => item.dispose());
    coatTexture.dispose();
  } };
}
