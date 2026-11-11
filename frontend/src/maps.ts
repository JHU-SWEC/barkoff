// Duel stages. The server picks one per duel (backend/duels.py STAGES); the ids must match.
export type MapId = 'sidewalk' | 'park' | 'vet' | 'petco' | 'playground'

export const MAPS: { id: MapId; name: string }[] = [
  { id: 'sidewalk', name: 'Sidewalk' },
  { id: 'park', name: 'Dog Park' },
  { id: 'vet', name: 'The Vet' },
  { id: 'petco', name: 'Petco' },
  { id: 'playground', name: 'Playground' },
]

export function mapIndex(id: string): number {
  return Math.max(0, MAPS.findIndex((m) => m.id === id))
}
