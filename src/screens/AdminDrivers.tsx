// The drivers list now lives in `src/screens/drivers/`. This module keeps the
// original export name so routing in `src/App.tsx` is unchanged.
export {
  DriversListScreen as AdminDrivers,
  type DriversListScreenProps as AdminDriversProps,
} from './drivers/DriversListScreen'
