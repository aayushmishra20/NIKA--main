import React, { useState, useEffect, useReducer, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader } from "lucide-react";
import { useInView } from "react-intersection-observer";
import { useDataContext } from "../context/DataContext";
import { Responsive, WidthProvider } from "react-grid-layout";
// lightweight deep-equal to avoid adding lodash dependency for this component
const isEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!kb.includes(k)) return false;
    if (!isEqual(a[k], b[k])) return false;
  }
  return true;
};
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  LineChart, Line, AreaChart, Area, PieChart, Pie, Legend, Treemap, ScatterChart, Scatter
} from "recharts";
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

/**
 * Updated: produce vertically stacked full-width charts (single-column layout).
 * - Each chart now occupies full width (w:12) and doubled height compared to previous layout.
 * - Charts are stacked in a single linear column (aligned both horizontally and vertically).
 * - Chart aspect tuned to be taller to match the doubled size.
 * - This makes each graph visually larger and perfectly aligned in a straight line.
 */

/* ============================
   Type Definitions
   ============================ */
type DataRow = Record<string, any>;
type ChartDataPoint = { name: string; value: number; size: number; };
type AggregationMethod = "none" | "sum" | "average" | "count" | "min" | "max";
type SortKey = "x" | "y";
type SortDirection = "asc" | "desc";
type ColorPalette = "vibrant" | "cool" | "forest" | "sunset";
type Filter = { column: string; value: any; type: 'categorical' | 'range'; };

interface ChartState {
  xAxis: string;
  yAxis: string;
  aggregation: AggregationMethod;
  sortKey: SortKey;
  sortDirection: SortDirection;
  colorPalette: ColorPalette;
  filters: Filter[];
  layout: any;
  isProcessing: boolean;
}

/* ============================
   Constants & Reducer
   ============================ */
const COLOR_PALETTES: Record<ColorPalette, string[]> = {
  vibrant: ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"],
  cool: ["#06B6D4", "#3B82F6", "#6366F1", "#A78BFA", "#C084FC", "#34D399"],
  forest: ["#10B981", "#22C55E", "#84CC16", "#F59E0B", "#65A30D", "#15803D"],
  sunset: ["#F97316", "#EF4444", "#EC4899", "#D946EF", "#F59E0B", "#E11D48"],
};

// Each item occupies full width (w:12) so they stack vertically. Height is doubled (previously ~14 -> now 28).
const INITIAL_LAYOUTS = {
  lg: [
    { i: 'bar', x: 0, y: 0, w: 6, h: 8 },
    { i: 'line', x: 6, y: 0, w: 6, h: 8 },
    { i: 'area', x: 0, y: 8, w: 6, h: 8 },

    { i: 'pie', x: 6, y: 8, w: 6, h: 8 },
    { i: 'scatter', x: 0, y: 16, w: 6, h: 8 },
    { i: 'treemap', x: 6, y: 16, w: 6, h: 8 },
  ],
};

const chartStateReducer = (state: ChartState, action: any): ChartState => {
  switch (action.type) {
    case "SET_AXIS": {
      const { axis, value } = action.payload;
      if (axis === 'x' && value === state.yAxis) return { ...state, xAxis: value, yAxis: state.xAxis };
      if (axis === 'y' && value === state.xAxis) return { ...state, yAxis: value, xAxis: state.yAxis };
      return { ...state, [axis === 'x' ? 'xAxis' : 'yAxis']: value };
    }
    case "SET_AGGREGATION": return { ...state, aggregation: action.payload };
    case "SET_SORT": return { ...state, sortKey: action.payload.key, sortDirection: action.payload.direction };
    case "SET_PALETTE": return { ...state, colorPalette: action.payload };
    case "SET_RANGE_FILTER": {
      const newFilters = state.filters.filter(f => f.column !== action.payload.column);
      return { ...state, filters: [...newFilters, { ...action.payload, type: 'range'}] };
    }
    case "ADD_FILTER": {
      const without = state.filters.filter((f: Filter) => f.column !== action.payload.column);
      return { ...state, filters: [...without, { ...action.payload, type: 'categorical' }] };
    }
    case "RESET_FILTERS": return { ...state, filters: [] };
    case "INIT_STATE": return { ...state, ...action.payload };
    case "SET_LAYOUT": return { ...state, layout: action.payload };
    case "SET_PROCESSING": return { ...state, isProcessing: action.payload };
    default: return state;
  }
};

  
const useDataProcessor = (onDataProcessed: (data: ChartDataPoint[]) => void, onProcessingChange: (isProcessing: boolean) => void) => {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize the worker
    workerRef.current = new Worker('/data.worker.js');
    
    workerRef.current.onmessage = (event) => {
      const { status, data, error } = event.data;
      if (status === "success") {
        onDataProcessed(data);
      } else {
        console.error("Worker Error:", error);
      }
      onProcessingChange(false);
    };
    
    // Cleanup
    return () => workerRef.current?.terminate();
  }, [onDataProcessed, onProcessingChange]);

  const processData = useCallback((data: DataRow[], config: any) => {
    if (workerRef.current) {
        onProcessingChange(true);
        workerRef.current.postMessage({ data, config });
    }
  }, [onProcessingChange]);

  return { processData };
};

// Dynamic grid row height tuned for full-width tall charts (doubling visual size).
const useDynamicRowHeight = (colsPerRow = 2, itemH = 12, marginX = 16, headerPx = 64) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState<number>(48);

  const calculate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const sampleItem = container.querySelector('.react-grid-item') as HTMLElement | null;
    if (sampleItem) {
      const itemStyle = window.getComputedStyle(sampleItem);
      const paddingTop = parseFloat(itemStyle.paddingTop || '0');
      const paddingBottom = parseFloat(itemStyle.paddingBottom || '0');
      const paddingLeft = parseFloat(itemStyle.paddingLeft || '0');
      const paddingRight = parseFloat(itemStyle.paddingRight || '0');

      const headerEl = sampleItem.querySelector('.drag-handle') as HTMLElement | null || sampleItem.querySelector('h3') as HTMLElement | null;
      const headerHeight = headerEl ? (headerEl.getBoundingClientRect().height + (parseFloat(window.getComputedStyle(headerEl).marginBottom || '0'))) : 0;

      const cellInnerWidth = Math.max(0, sampleItem.clientWidth - paddingLeft - paddingRight);

      // Make charts tall: use 16:6 (wider height) to double visual size relative to typical 16:9
      const desiredChartHeight = Math.max(240, Math.round(cellInnerWidth * 6 / 16));

      const desiredItemHeight = desiredChartHeight + headerHeight + paddingTop + paddingBottom;

      const rh = Math.max(24, Math.round(desiredItemHeight / itemH));
      setRowHeight(rh);
      return;
    }

    const width = container.clientWidth ?? Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const totalMargins = Math.max(0, colsPerRow - 1) * marginX;
    const cellWidth = Math.floor((width - totalMargins) / colsPerRow);
    const rh = Math.max(40, Math.round((cellWidth * 6/16 + headerPx) / itemH));
    setRowHeight(rh);
  }, [colsPerRow, itemH, marginX]);

  useEffect(() => {
    calculate();
    const onResize = () => calculate();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [calculate]);

  return { containerRef, rowHeight };
};

/* ============================
   UI Components
   ============================ */

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-sm shadow-lg">
        <p className="font-bold text-white mb-1">{label}</p>
        {payload.map((pld: any, index: number) => (
          <p key={index} style={{ color: pld.color || "#FFFFFF" }} className="text-sm">
            {`${pld.name}: ${Number(pld.value).toLocaleString()}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const ChartWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.05 });

  return (
    <div ref={ref} className="h-full w-full flex items-stretch justify-center">
      {inView ? (
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1", // square visual\n            minHeight: 120,
            position: "relative",
            display: "block",
          }}
        >
          <div style={{ position: "absolute", inset: 0 }}>
            {children}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500">
          Loading Chart...
        </div>
      )}
    </div>
  );
};

/* ============================
   Main Visualizations Component
   ============================ */
const Visualizations: React.FC = () => {
  const { dataset } = useDataContext();

  const initialState: ChartState = {
    xAxis: "", yAxis: "", aggregation: "sum", sortKey: "y", sortDirection: "desc",
    colorPalette: "vibrant", filters: [], layout: INITIAL_LAYOUTS, isProcessing: false,
  };

  const [state, dispatch] = useReducer(chartStateReducer, initialState);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  

  // Memoize column types to avoid re-calculation
  const { allColumns, numericColumns, categoricalColumns } = useMemo(() => {
    if (!dataset?.columns) return { allColumns: [], numericColumns: [], categoricalColumns: [] };
    const numeric: string[] = [];
    const categorical: string[] = [];
    const sample = dataset.data?.[0] || {};
    for (const col of dataset.columns) {
      if (typeof sample[col.name] === 'number') numeric.push(col.name);
      else categorical.push(col.name);
    }
    return { allColumns: dataset.columns.map(c => c.name), numericColumns: numeric, categoricalColumns: categorical };
  }, [dataset]);
  
  // Initialize axes on dataset load
  useEffect(() => {
    if (allColumns.length > 0 && !state.xAxis) {
      const initialX = categoricalColumns[0] || allColumns[0];
      const initialY = numericColumns[0] || allColumns[1] || allColumns[0];
      dispatch({ type: "INIT_STATE", payload: { xAxis: initialX, yAxis: initialY } });
    }
  }, [allColumns, categoricalColumns, numericColumns, state.xAxis]);

  // Setup Web Worker communication
  const { processData } = useDataProcessor(
    useCallback((data) => setChartData(data), []),
    useCallback((isProcessing) => dispatch({ type: "SET_PROCESSING", payload: isProcessing }), [])
  );

  // Trigger data processing in the worker when dependencies change
  useEffect(() => {
    if (dataset?.data && state.xAxis && state.yAxis) {
      const config = {
        xAxis: state.xAxis, yAxis: state.yAxis, aggregation: state.aggregation, filters: state.filters,
        sortKey: state.sortKey, sortDirection: state.sortDirection, numericColumns
      };
      processData(dataset.data, config);
    }
  }, [dataset?.data, state.xAxis, state.yAxis, state.aggregation, state.filters, state.sortKey, state.sortDirection, numericColumns, processData]);

  // dynamic grid sizing: single column
  const { containerRef: gridContainerRef, rowHeight } = useDynamicRowHeight(1, 6);

  // --- INTERACTIVITY HANDLERS ---
  const handleBarClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload?.name) {
      dispatch({ type: "ADD_FILTER", payload: { column: state.xAxis, value: data.activePayload[0].payload.name } });
    }
  };
  
  const handlePieClick = (data: any) => {
     if (data?.name) {
      dispatch({ type: "ADD_FILTER", payload: { column: state.xAxis, value: data.name } });
    }
  };

  const handleLayoutChange = (_: any, allLayouts: ReactGridLayout.Layouts) => {
    if (!isEqual(allLayouts, state.layout)) {
      dispatch({ type: "SET_LAYOUT", payload: allLayouts });
    }
  };

  // --- CHART RENDERING ---
  // KEEP only 6 charts (stacked vertically full-width). 
  const chartConfigs: { id: string; title: string; component: React.ReactNode }[] = [
    { id: 'bar', title: 'Bar Chart', component: (
      <BarChart data={chartData} onClick={handleBarClick}>
        <CartesianGrid stroke="#1F2937" />
        <XAxis dataKey="name" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="value" name={state.yAxis}>
          {chartData.map((_: any, index: number) => <Cell key={`cell-${index}`} fill={COLOR_PALETTES[state.colorPalette][index % COLOR_PALETTES[state.colorPalette].length]} />)}
        </Bar>
      </BarChart>
    )},
    { id: 'line', title: 'Line Chart', component: (
      <LineChart data={chartData}>
        <CartesianGrid stroke="#1F2937" />
        <XAxis dataKey="name" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="value" stroke={COLOR_PALETTES[state.colorPalette][2]} strokeWidth={2} dot={false} />
      </LineChart>
    )},
    { id: 'area', title: 'Area Chart', component: (
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={COLOR_PALETTES[state.colorPalette][1]} stopOpacity={0.8}/>
            <stop offset="95%" stopColor={COLOR_PALETTES[state.colorPalette][1]} stopOpacity={0.1}/>
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1F2937" />
        <XAxis dataKey="name" stroke="#9CA3AF" />
        <YAxis stroke="#9CA3AF" />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="value" stroke={COLOR_PALETTES[state.colorPalette][1]} fill="url(#areaGrad)" />
      </AreaChart>
    )},
    { id: 'pie', title: 'Pie Chart', component: (
      <PieChart>
        <Tooltip content={<CustomTooltip />} />
        <Pie data={chartData.slice(0, 8)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={80} onClick={handlePieClick}>
          {chartData.slice(0, 8).map((_: any, index: number) => <Cell key={`cell-${index}`} fill={COLOR_PALETTES[state.colorPalette][index % COLOR_PALETTES[state.colorPalette].length]} />)}
        </Pie>
        <Legend />
      </PieChart>
    )},
    { id: 'scatter', title: 'Scatter Plot', component: (
      <ScatterChart>
        <CartesianGrid />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Scatter data={chartData.map((d: any,i: number) => ({ x: i, y: d.value, name: d.name }))} fill={COLOR_PALETTES[state.colorPalette][3]} />
      </ScatterChart>
    )},
    { id: 'treemap', title: 'Treemap', component: (
      <Treemap data={chartData.map((d: any) => ({ name: d.name, size: d.value }))} dataKey="size" />
    )},
  ];


  return (
    <div className="space-y-6 p-4 md:p-6 relative">
      <AnimatePresence>
        {state.isProcessing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-4 text-white">
              <Loader className="animate-spin h-10 w-10" />
              <span className="text-lg font-semibold">Processing Data...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* --- HEADER & CONTROLS --- */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700">
        <h2 className="text-2xl font-bold text-white mb-4">Advanced Analytics Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {/* Control Selects: X-Axis, Y-Axis, Aggregation, etc. */}
            <div>
              <label className="text-xs font-medium text-gray-400">X-Axis</label>
              <select value={state.xAxis} onChange={e => dispatch({type: 'SET_AXIS', payload: {axis: 'x', value: e.target.value}})} className="w-full bg-gray-700 border-gray-600 text-white rounded p-2 mt-1">
                {allColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400">Y-Axis</label>
              <select value={state.yAxis} onChange={e => dispatch({type: 'SET_AXIS', payload: {axis: 'y', value: e.target.value}})} className="w-full bg-gray-700 border-gray-600 text-white rounded p-2 mt-1">
                {numericColumns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400">Aggregation</label>
              <select value={state.aggregation} onChange={e => dispatch({type: 'SET_AGGREGATION', payload: e.target.value as AggregationMethod})} className="w-full bg-gray-700 border-gray-600 text-white rounded p-2 mt-1">
                <option value="sum">Sum</option>
                <option value="average">Average</option>
                <option value="count">Count</option>
                <option value="none">None</option>
              </select>
            </div>
             <div>
              <label className="text-xs font-medium text-gray-400">Sort By</label>
              <select value={`${state.sortKey}-${state.sortDirection}`} onChange={(e) => { const [k, d] = e.target.value.split("-"); dispatch({ type: "SET_SORT", payload: { key: k as SortKey, direction: d as SortDirection } }); }} className="w-full bg-gray-700 border border-gray-600 text-white rounded p-2 mt-1">
                  <option value="y-desc">Value (High→Low)</option>
                  <option value="y-asc">Value (Low→High)</option>
                  <option value="x-asc">Category (A→Z)</option>
                  <option value="x-desc">Category (Z→A)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400">Color Palette</label>
              <select value={state.colorPalette} onChange={(e) => dispatch({ type: "SET_PALETTE", payload: e.target.value as ColorPalette })} className="w-full bg-gray-700 border border-gray-600 text-white rounded p-2 mt-1">
                  <option value="vibrant">Vibrant</option>
                  <option value="cool">Cool</option>
                  <option value="forest">Forest</option>
                  <option value="sunset">Sunset</option>
              </select>
            </div>
        </div>

        
      </motion.div>

      {/* --- GRID LAYOUT --- */}
      <div ref={gridContainerRef}>
      <ResponsiveGridLayout
        className="layout"
        layouts={state.layout}
        onLayoutChange={handleLayoutChange}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={rowHeight}
        margin={[12, 12]}
        compactType="vertical"
        draggableHandle=".drag-handle"
      >
        {chartConfigs.map(config => (
          <div key={config.id} className="bg-gray-800/30 rounded-xl border border-gray-700 overflow-hidden flex items-stretch">
            <div className="p-3 h-full w-full flex flex-col">
              <h3 className="text-white font-semibold mb-2 drag-handle cursor-move">{config.title}</h3>
              <div className="flex-grow flex items-center justify-center">
                 <ChartWrapper>
                    <ResponsiveContainer width="100%" height="100%">
                      {(config.component as any) ?? <div />}
                    </ResponsiveContainer>
                 </ChartWrapper>
              </div>
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>
      </div>
    </div>
  );
};

export default Visualizations;
