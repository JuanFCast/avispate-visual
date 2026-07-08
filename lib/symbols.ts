export type SymbolColor =
  | "rojo"
  | "naranja"
  | "amarillo"
  | "verde"
  | "azul"
  | "morado"
  | "rosado"
  | "cafe"
  | "blanco"
  | "negro"
  | "multi";

export type SymbolCategory =
  | "animal"
  | "comida"
  | "naturaleza"
  | "objeto"
  | "transporte"
  | "deporte";

export interface Symbol {
  id: string;
  label: string;
  emoji: string;
  /** Color dominante: se usa para elegir distractores parecidos al objetivo. */
  color: SymbolColor;
  category: SymbolCategory;
}

// Banco de símbolos propios (emojis), con color y categoría para poder rodear
// al símbolo común de distractores parecidos (si el común es la manzana, la
// carta se llena de cosas rojas y de comidas).
export const SYMBOLS: Symbol[] = [
  // Naturaleza
  { id: "sun", label: "Sol", emoji: "☀️", color: "amarillo", category: "naturaleza" },
  { id: "moon", label: "Luna", emoji: "🌙", color: "amarillo", category: "naturaleza" },
  { id: "star", label: "Estrella", emoji: "⭐", color: "amarillo", category: "naturaleza" },
  { id: "bolt", label: "Rayo", emoji: "⚡", color: "amarillo", category: "naturaleza" },
  { id: "sunflower", label: "Girasol", emoji: "🌻", color: "amarillo", category: "naturaleza" },
  { id: "fire", label: "Fuego", emoji: "🔥", color: "naranja", category: "naturaleza" },
  { id: "drop", label: "Gota", emoji: "💧", color: "azul", category: "naturaleza" },
  { id: "snow", label: "Copo", emoji: "❄️", color: "azul", category: "naturaleza" },
  { id: "rainbow", label: "Arcoíris", emoji: "🌈", color: "multi", category: "naturaleza" },
  { id: "clover", label: "Trébol", emoji: "🍀", color: "verde", category: "naturaleza" },
  { id: "cactus", label: "Cactus", emoji: "🌵", color: "verde", category: "naturaleza" },
  { id: "blossom", label: "Flor", emoji: "🌸", color: "rosado", category: "naturaleza" },

  // Comida
  { id: "apple", label: "Manzana", emoji: "🍎", color: "rojo", category: "comida" },
  { id: "strawberry", label: "Fresa", emoji: "🍓", color: "rojo", category: "comida" },
  { id: "watermelon", label: "Sandía", emoji: "🍉", color: "rojo", category: "comida" },
  { id: "mushroom", label: "Hongo", emoji: "🍄", color: "rojo", category: "comida" },
  { id: "carrot", label: "Zanahoria", emoji: "🥕", color: "naranja", category: "comida" },
  { id: "orange", label: "Naranja", emoji: "🍊", color: "naranja", category: "comida" },
  { id: "pizza", label: "Pizza", emoji: "🍕", color: "naranja", category: "comida" },
  { id: "banana", label: "Banano", emoji: "🍌", color: "amarillo", category: "comida" },
  { id: "pineapple", label: "Piña", emoji: "🍍", color: "amarillo", category: "comida" },
  { id: "avocado", label: "Aguacate", emoji: "🥑", color: "verde", category: "comida" },
  { id: "broccoli", label: "Brócoli", emoji: "🥦", color: "verde", category: "comida" },
  { id: "grapes", label: "Uvas", emoji: "🍇", color: "morado", category: "comida" },
  { id: "blueberries", label: "Arándanos", emoji: "🫐", color: "morado", category: "comida" },
  { id: "icecream", label: "Helado", emoji: "🍦", color: "blanco", category: "comida" },

  // Animales
  { id: "crab", label: "Cangrejo", emoji: "🦀", color: "rojo", category: "animal" },
  { id: "ladybug", label: "Mariquita", emoji: "🐞", color: "rojo", category: "animal" },
  { id: "octopus", label: "Pulpo", emoji: "🐙", color: "rojo", category: "animal" },
  { id: "cat", label: "Gato", emoji: "🐱", color: "naranja", category: "animal" },
  { id: "bee", label: "Abeja", emoji: "🐝", color: "amarillo", category: "animal" },
  { id: "frog", label: "Rana", emoji: "🐸", color: "verde", category: "animal" },
  { id: "turtle", label: "Tortuga", emoji: "🐢", color: "verde", category: "animal" },
  { id: "crocodile", label: "Caimán", emoji: "🐊", color: "verde", category: "animal" },
  { id: "butterfly", label: "Mariposa", emoji: "🦋", color: "azul", category: "animal" },
  { id: "whale", label: "Ballena", emoji: "🐳", color: "azul", category: "animal" },
  { id: "dolphin", label: "Delfín", emoji: "🐬", color: "azul", category: "animal" },
  { id: "unicorn", label: "Unicornio", emoji: "🦄", color: "rosado", category: "animal" },
  { id: "flamingo", label: "Flamenco", emoji: "🦩", color: "rosado", category: "animal" },
  { id: "dog", label: "Perro", emoji: "🐶", color: "cafe", category: "animal" },
  { id: "penguin", label: "Pingüino", emoji: "🐧", color: "negro", category: "animal" },

  // Transporte
  { id: "car", label: "Carro", emoji: "🚗", color: "rojo", category: "transporte" },
  { id: "bike", label: "Bicicleta", emoji: "🚲", color: "rojo", category: "transporte" },
  { id: "rocket", label: "Cohete", emoji: "🚀", color: "blanco", category: "transporte" },

  // Deporte
  { id: "basketball", label: "Baloncesto", emoji: "🏀", color: "naranja", category: "deporte" },
  { id: "soccer", label: "Balón", emoji: "⚽", color: "negro", category: "deporte" },

  // Objetos
  { id: "balloon", label: "Globo", emoji: "🎈", color: "rojo", category: "objeto" },
  { id: "gift", label: "Regalo", emoji: "🎁", color: "rojo", category: "objeto" },
  { id: "magnet", label: "Imán", emoji: "🧲", color: "rojo", category: "objeto" },
  { id: "key", label: "Llave", emoji: "🔑", color: "amarillo", category: "objeto" },
  { id: "lock", label: "Candado", emoji: "🔒", color: "amarillo", category: "objeto" },
  { id: "bell", label: "Campana", emoji: "🔔", color: "amarillo", category: "objeto" },
  { id: "bulb", label: "Bombillo", emoji: "💡", color: "amarillo", category: "objeto" },
  { id: "trumpet", label: "Trompeta", emoji: "🎺", color: "amarillo", category: "objeto" },
  { id: "anchor", label: "Ancla", emoji: "⚓", color: "azul", category: "objeto" },
  { id: "crystal", label: "Bola de cristal", emoji: "🔮", color: "morado", category: "objeto" },
  { id: "guitar", label: "Guitarra", emoji: "🎸", color: "cafe", category: "objeto" },
  { id: "dice", label: "Dado", emoji: "🎲", color: "blanco", category: "objeto" },
  { id: "palette", label: "Paleta", emoji: "🎨", color: "multi", category: "objeto" },
];

export const SYMBOL_BY_ID: Record<string, Symbol> = Object.fromEntries(
  SYMBOLS.map((s) => [s.id, s])
);
