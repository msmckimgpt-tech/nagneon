export type GenrePreset = { id: string; name: string; genre: string; context: string; popularity: number };
export const genrePresets: GenrePreset[];
export function addGenrePresets<T extends {id: string}>(games: T[]): (T | GenrePreset)[];
