export interface Symbol {
  id: string;
  label: string;
  emoji: string;
}

// Banco de símbolos propios (emojis): 48 opciones bien diferenciables entre sí.
export const SYMBOLS: Symbol[] = [
  { id: "sun", label: "Sol", emoji: "☀️" },
  { id: "moon", label: "Luna", emoji: "🌙" },
  { id: "star", label: "Estrella", emoji: "⭐" },
  { id: "bolt", label: "Rayo", emoji: "⚡" },
  { id: "fire", label: "Fuego", emoji: "🔥" },
  { id: "drop", label: "Gota", emoji: "💧" },
  { id: "snow", label: "Copo", emoji: "❄️" },
  { id: "rainbow", label: "Arcoíris", emoji: "🌈" },
  { id: "apple", label: "Manzana", emoji: "🍎" },
  { id: "banana", label: "Banano", emoji: "🍌" },
  { id: "grapes", label: "Uvas", emoji: "🍇" },
  { id: "watermelon", label: "Sandía", emoji: "🍉" },
  { id: "pineapple", label: "Piña", emoji: "🍍" },
  { id: "avocado", label: "Aguacate", emoji: "🥑" },
  { id: "pizza", label: "Pizza", emoji: "🍕" },
  { id: "icecream", label: "Helado", emoji: "🍦" },
  { id: "cat", label: "Gato", emoji: "🐱" },
  { id: "dog", label: "Perro", emoji: "🐶" },
  { id: "frog", label: "Rana", emoji: "🐸" },
  { id: "butterfly", label: "Mariposa", emoji: "🦋" },
  { id: "bee", label: "Abeja", emoji: "🐝" },
  { id: "octopus", label: "Pulpo", emoji: "🐙" },
  { id: "turtle", label: "Tortuga", emoji: "🐢" },
  { id: "penguin", label: "Pingüino", emoji: "🐧" },
  { id: "whale", label: "Ballena", emoji: "🐳" },
  { id: "unicorn", label: "Unicornio", emoji: "🦄" },
  { id: "crab", label: "Cangrejo", emoji: "🦀" },
  { id: "ladybug", label: "Mariquita", emoji: "🐞" },
  { id: "rocket", label: "Cohete", emoji: "🚀" },
  { id: "car", label: "Carro", emoji: "🚗" },
  { id: "bike", label: "Bicicleta", emoji: "🚲" },
  { id: "anchor", label: "Ancla", emoji: "⚓" },
  { id: "balloon", label: "Globo", emoji: "🎈" },
  { id: "gift", label: "Regalo", emoji: "🎁" },
  { id: "soccer", label: "Balón", emoji: "⚽" },
  { id: "basketball", label: "Baloncesto", emoji: "🏀" },
  { id: "dice", label: "Dado", emoji: "🎲" },
  { id: "guitar", label: "Guitarra", emoji: "🎸" },
  { id: "trumpet", label: "Trompeta", emoji: "🎺" },
  { id: "palette", label: "Paleta", emoji: "🎨" },
  { id: "key", label: "Llave", emoji: "🔑" },
  { id: "lock", label: "Candado", emoji: "🔒" },
  { id: "bell", label: "Campana", emoji: "🔔" },
  { id: "magnet", label: "Imán", emoji: "🧲" },
  { id: "bulb", label: "Bombillo", emoji: "💡" },
  { id: "clover", label: "Trébol", emoji: "🍀" },
  { id: "cactus", label: "Cactus", emoji: "🌵" },
  { id: "mushroom", label: "Hongo", emoji: "🍄" },
];

export const SYMBOL_BY_ID: Record<string, Symbol> = Object.fromEntries(
  SYMBOLS.map((s) => [s.id, s])
);
