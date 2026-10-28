// The presentational layer of the roles & permissions page. Shared by the real
// page (src/components/roles/RolesSettings.tsx) and the approved mockup on
// /ui-kit (src/screens/ui-kit/RolesPageMockup.tsx), so the two cannot drift.
// Nothing here imports Supabase (tests/uiKitRolesMockup.test.cjs).
export * from './model'
export { ScopeSegments } from './ScopeSegments'
export { TriStateCheckbox, type TriState } from './TriStateCheckbox'
export { DisabledTooltip } from './DisabledTooltip'
export { RolesList } from './RolesList'
export { RolePanel, ROLE_PANEL_TABS, type RolePanelTab } from './RolePanel'
export {
  PermissionsTable,
  type PermissionsSaveOutcome,
  type PermissionsTableProps,
} from './PermissionsTable'
export { RoleUsersTable, AssignUserDialog } from './RoleUsersTable'
export { ChangesTable } from './ChangesTable'
export {
  RoleFormDialog,
  type RoleFormOutcome,
  type RoleFormRole,
  type RoleFormValues,
} from './RoleFormDialog'
export {
  SystemSettingsDialog,
  type SystemSettingsDialogProps,
  type SystemStatus,
} from './SystemSettingsDialog'
