// The equipment list now lives in `src/screens/equipment/`. This module keeps
// the original export name so routing in `src/App.tsx` is unchanged.
export {
  EquipmentListScreen as AdminEquipment,
  type EquipmentListScreenProps as AdminEquipmentProps,
} from './equipment/EquipmentListScreen'
