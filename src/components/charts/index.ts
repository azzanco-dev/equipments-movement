// Charts for the dashboards. Every color is a design token, so the charts
// follow the approved light/dark palette automatically.
//
// This barrel stays free of Recharts on purpose: the Recharts-backed charts
// (EntriesLineChart, FleetDonut) are approved for the admin home only and are
// imported from `@/components/charts/lazy`, which loads them with
// `next/dynamic`. Re-exporting them here would make every importer of this
// barrel pull the library in eagerly.
export { HorizontalBarList } from './HorizontalBarList'
export type {
  HorizontalBarItem,
  HorizontalBarListProps,
} from './HorizontalBarList'
export {
  CHART_SERIES_COLORS,
  ChartLegend,
  ChartShell,
  ChartSrTable,
} from './chartShared'
export type {
  ChartBaseProps,
  ChartDirection,
  ChartLegendItem,
} from './chartShared'
