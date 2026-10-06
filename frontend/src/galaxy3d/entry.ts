import { BattleView } from "./battleView";
import { armyOf } from "./catalog";
import { PlanetSprites } from "./mapSprites";
import { PlanetView } from "./planetView";
import { shipSprites } from "./sprites";

// Подключается со статической страницы galaxy-map.html динамическим import(),
// поэтому наружу — обычный объект на window, без React.
const api = { PlanetView, BattleView, PlanetSprites, shipSprites, armyOf };
(window as unknown as { Galaxy3D: typeof api }).Galaxy3D = api;
export default api;
