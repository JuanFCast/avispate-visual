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

/**
 * El nombre del símbolo en los dos idiomas. Solo se usa como `aria-label` del
 * botón: quien juega mirando ve el emoji, quien juega con lector de pantalla
 * necesita oírlo en su idioma. Vive aquí y no en `lib/i18n` porque es un dato
 * del banco de símbolos, no copy de la interfaz.
 */
export interface SymbolLabel {
  en: string;
  es: string;
}

export interface Symbol {
  id: string;
  label: SymbolLabel;
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
  { id: "sun", label: { en: "Sun", es: "Sol" }, emoji: "☀️", color: "amarillo", category: "naturaleza" },
  { id: "moon", label: { en: "Moon", es: "Luna" }, emoji: "🌙", color: "amarillo", category: "naturaleza" },
  { id: "star", label: { en: "Star", es: "Estrella" }, emoji: "⭐", color: "amarillo", category: "naturaleza" },
  { id: "bolt", label: { en: "Lightning", es: "Rayo" }, emoji: "⚡", color: "amarillo", category: "naturaleza" },
  { id: "sunflower", label: { en: "Sunflower", es: "Girasol" }, emoji: "🌻", color: "amarillo", category: "naturaleza" },
  { id: "fire", label: { en: "Fire", es: "Fuego" }, emoji: "🔥", color: "naranja", category: "naturaleza" },
  { id: "drop", label: { en: "Droplet", es: "Gota" }, emoji: "💧", color: "azul", category: "naturaleza" },
  { id: "snow", label: { en: "Snowflake", es: "Copo" }, emoji: "❄️", color: "azul", category: "naturaleza" },
  { id: "rainbow", label: { en: "Rainbow", es: "Arcoíris" }, emoji: "🌈", color: "multi", category: "naturaleza" },
  { id: "clover", label: { en: "Clover", es: "Trébol" }, emoji: "🍀", color: "verde", category: "naturaleza" },
  { id: "cactus", label: { en: "Cactus", es: "Cactus" }, emoji: "🌵", color: "verde", category: "naturaleza" },
  { id: "blossom", label: { en: "Flower", es: "Flor" }, emoji: "🌸", color: "rosado", category: "naturaleza" },

  // Comida
  { id: "apple", label: { en: "Apple", es: "Manzana" }, emoji: "🍎", color: "rojo", category: "comida" },
  { id: "strawberry", label: { en: "Strawberry", es: "Fresa" }, emoji: "🍓", color: "rojo", category: "comida" },
  { id: "watermelon", label: { en: "Watermelon", es: "Sandía" }, emoji: "🍉", color: "rojo", category: "comida" },
  { id: "mushroom", label: { en: "Mushroom", es: "Hongo" }, emoji: "🍄", color: "rojo", category: "comida" },
  { id: "carrot", label: { en: "Carrot", es: "Zanahoria" }, emoji: "🥕", color: "naranja", category: "comida" },
  { id: "orange", label: { en: "Orange", es: "Naranja" }, emoji: "🍊", color: "naranja", category: "comida" },
  { id: "pizza", label: { en: "Pizza", es: "Pizza" }, emoji: "🍕", color: "naranja", category: "comida" },
  { id: "banana", label: { en: "Banana", es: "Banano" }, emoji: "🍌", color: "amarillo", category: "comida" },
  { id: "pineapple", label: { en: "Pineapple", es: "Piña" }, emoji: "🍍", color: "amarillo", category: "comida" },
  { id: "avocado", label: { en: "Avocado", es: "Aguacate" }, emoji: "🥑", color: "verde", category: "comida" },
  { id: "broccoli", label: { en: "Broccoli", es: "Brócoli" }, emoji: "🥦", color: "verde", category: "comida" },
  { id: "grapes", label: { en: "Grapes", es: "Uvas" }, emoji: "🍇", color: "morado", category: "comida" },
  { id: "blueberries", label: { en: "Blueberries", es: "Arándanos" }, emoji: "🫐", color: "morado", category: "comida" },
  { id: "icecream", label: { en: "Ice cream", es: "Helado" }, emoji: "🍦", color: "blanco", category: "comida" },

  // Animales
  { id: "crab", label: { en: "Crab", es: "Cangrejo" }, emoji: "🦀", color: "rojo", category: "animal" },
  { id: "ladybug", label: { en: "Ladybug", es: "Mariquita" }, emoji: "🐞", color: "rojo", category: "animal" },
  { id: "octopus", label: { en: "Octopus", es: "Pulpo" }, emoji: "🐙", color: "rojo", category: "animal" },
  { id: "cat", label: { en: "Cat", es: "Gato" }, emoji: "🐱", color: "naranja", category: "animal" },
  { id: "bee", label: { en: "Bee", es: "Abeja" }, emoji: "🐝", color: "amarillo", category: "animal" },
  { id: "frog", label: { en: "Frog", es: "Rana" }, emoji: "🐸", color: "verde", category: "animal" },
  { id: "turtle", label: { en: "Turtle", es: "Tortuga" }, emoji: "🐢", color: "verde", category: "animal" },
  { id: "crocodile", label: { en: "Crocodile", es: "Caimán" }, emoji: "🐊", color: "verde", category: "animal" },
  { id: "butterfly", label: { en: "Butterfly", es: "Mariposa" }, emoji: "🦋", color: "azul", category: "animal" },
  { id: "whale", label: { en: "Whale", es: "Ballena" }, emoji: "🐳", color: "azul", category: "animal" },
  { id: "dolphin", label: { en: "Dolphin", es: "Delfín" }, emoji: "🐬", color: "azul", category: "animal" },
  { id: "unicorn", label: { en: "Unicorn", es: "Unicornio" }, emoji: "🦄", color: "rosado", category: "animal" },
  { id: "flamingo", label: { en: "Flamingo", es: "Flamenco" }, emoji: "🦩", color: "rosado", category: "animal" },
  { id: "dog", label: { en: "Dog", es: "Perro" }, emoji: "🐶", color: "cafe", category: "animal" },
  { id: "penguin", label: { en: "Penguin", es: "Pingüino" }, emoji: "🐧", color: "negro", category: "animal" },

  // Transporte
  { id: "car", label: { en: "Car", es: "Carro" }, emoji: "🚗", color: "rojo", category: "transporte" },
  { id: "bike", label: { en: "Bicycle", es: "Bicicleta" }, emoji: "🚲", color: "rojo", category: "transporte" },
  { id: "rocket", label: { en: "Rocket", es: "Cohete" }, emoji: "🚀", color: "blanco", category: "transporte" },

  // Deporte
  { id: "basketball", label: { en: "Basketball", es: "Baloncesto" }, emoji: "🏀", color: "naranja", category: "deporte" },
  { id: "soccer", label: { en: "Soccer ball", es: "Balón" }, emoji: "⚽", color: "negro", category: "deporte" },

  // Objetos
  { id: "balloon", label: { en: "Balloon", es: "Globo" }, emoji: "🎈", color: "rojo", category: "objeto" },
  { id: "gift", label: { en: "Gift", es: "Regalo" }, emoji: "🎁", color: "rojo", category: "objeto" },
  { id: "magnet", label: { en: "Magnet", es: "Imán" }, emoji: "🧲", color: "rojo", category: "objeto" },
  { id: "key", label: { en: "Key", es: "Llave" }, emoji: "🔑", color: "amarillo", category: "objeto" },
  { id: "lock", label: { en: "Lock", es: "Candado" }, emoji: "🔒", color: "amarillo", category: "objeto" },
  { id: "bell", label: { en: "Bell", es: "Campana" }, emoji: "🔔", color: "amarillo", category: "objeto" },
  { id: "bulb", label: { en: "Light bulb", es: "Bombillo" }, emoji: "💡", color: "amarillo", category: "objeto" },
  { id: "trumpet", label: { en: "Trumpet", es: "Trompeta" }, emoji: "🎺", color: "amarillo", category: "objeto" },
  { id: "anchor", label: { en: "Anchor", es: "Ancla" }, emoji: "⚓", color: "azul", category: "objeto" },
  { id: "crystal", label: { en: "Crystal ball", es: "Bola de cristal" }, emoji: "🔮", color: "morado", category: "objeto" },
  { id: "guitar", label: { en: "Guitar", es: "Guitarra" }, emoji: "🎸", color: "cafe", category: "objeto" },
  { id: "dice", label: { en: "Dice", es: "Dado" }, emoji: "🎲", color: "blanco", category: "objeto" },
  { id: "palette", label: { en: "Palette", es: "Paleta" }, emoji: "🎨", color: "multi", category: "objeto" },
];

export const SYMBOL_BY_ID: Record<string, Symbol> = Object.fromEntries(
  SYMBOLS.map((s) => [s.id, s])
);
