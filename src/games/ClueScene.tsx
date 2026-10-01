import { Canvas } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import type { TileView } from '../../shared/types';
function Tiles({ board }: { board: TileView[] }) {
  const { size } = useThree(); const w = (size.width / 3 - 12) / 80; const h = (size.height / 4 - 12) / 80;
  return <>{board.map((tile, i) => <mesh key={i} position={[(i % 3 - 1) * size.width / 3 / 80, (1.5 - Math.floor(i / 3)) * size.height / 4 / 80, tile.status === 'hidden' ? 0 : .05]}>
    <boxGeometry args={[w, h, .12]} /><meshStandardMaterial color={tile.status === 'trap' ? '#6b5468' : tile.status === 'target' ? '#a1bca1' : tile.status === 'neutral' ? '#d4cab6' : tile.yourTarget ? '#d6dfc5' : '#eee1b9'} roughness={.9} />
  </mesh>)}</>;
}
export default function ClueScene({ board }: { board: TileView[] }) {
  return <Canvas aria-hidden="true" orthographic camera={{ position: [0, 0, 5], zoom: 80 }} frameloop="demand" dpr={[1, 1.25]} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}><ambientLight intensity={2} /><directionalLight position={[-3, 5, 5]} intensity={2} /><Tiles board={board} /></Canvas>;
}
