// Dependency-free SVG charts for the dashboards. Every color is a design
// token, so the charts follow the approved light/dark palette automatically.
export { BarChart } from './BarChart'
export type { BarChartProps, BarChartSeries } from './BarChart'
export { DonutChart } from './DonutChart'
export type { DonutChartProps, DonutSlice } from './DonutChart'
export { HorizontalBarList } from './HorizontalBarList'
export type {
  HorizontalBarItem,
  HorizontalBarListProps,
} from './HorizontalBarList'
export { StackedBar } from './StackedBar'
export type { StackedBarProps, StackedBarSegment } from './StackedBar'
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
