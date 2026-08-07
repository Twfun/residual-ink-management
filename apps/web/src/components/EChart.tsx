import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { RIM_CHART_COLORS } from '../theme';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

// Brand-aligned palette: 品牌绿 + 强调橙 + 明暗派生（统一定义在 theme.ts）
echarts.registerTheme('rim', {
  color: RIM_CHART_COLORS,
  textStyle: { fontFamily: "'Microsoft YaHei', Arial, sans-serif" },
});

export function EChart({ option, height = 260 }: { option: Record<string, unknown>; height?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  useEffect(() => {
    if (!hostRef.current) return;
    const chart = echarts.init(hostRef.current, 'rim');
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, []);
  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);
  return <div ref={hostRef} style={{ width: '100%', height }} />;
}
