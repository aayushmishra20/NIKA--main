import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
  memo,
} from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Database,
  PieChart as PieChartIcon,
  Users,
  Sparkles,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";

// Import types and context
import type { DataSummary } from "../types";
import { useDataContext } from "../context/DataContext";
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
} from "recharts";

/**
 * -----------------------------------------------------
 * Advanced Overview.tsx (single-file, animated, all-in-one)
 * -----------------------------------------------------
 * Fixed JSX structure, added missing helpers, and ensured
 * ProgressBar animates reliably when `quality` changes.
 */

// -----------------------------
// Types (defensive / optional)
// -----------------------------

type Row = Record<string, any>;

type Column = {
  name: string;
  type?: string;
  missingCount?: number;
  modified?: boolean;
};

type Dataset = {
  name?: string;
  uploadedAt?: Date | string | number;
  updatedAt?: Date | string | number;
  forced?: boolean;
  columns: Column[];
  data: Row[];
  originalData?: Row[];
  modifiedColumns?: string[];
  id?: string;
};

// --------------
// Color helpers
// --------------
const PALETTE = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#06B6D4",
  "#22C55E",
  "#EAB308",
];
const genColor = (i: number) => `hsl(${(i * 53) % 360} 70% 55%)`;

// ---------------------
// Utility / Data logic
// ---------------------
const isNumber = (v: any) =>
  typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v);

// Always show raw-ish value in table (avoid ISO noise). If Date-like, prettify.
const renderCell = (value: any): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (value instanceof Date) return value.toLocaleDateString("en-GB");
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB");
    }
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

// Pick one numeric and one categorical column for quick charts
const pickQuickColumns = (columns: Column[], data: Row[]) => {
  let numericCol: string | null = null;
  let categoricalCol: string | null = null;

  for (const col of columns) {
    if (!numericCol) {
      if (
        col.type?.toLowerCase().includes("num") ||
        col.type?.toLowerCase().includes("int")
      ) {
        numericCol = col.name;
      } else {
        const sample = data.slice(0, 20).map((r) => r[col.name]);
        const numLike = sample.filter(
          (v) =>
            isNumber(v) ||
            (!Number.isNaN(Number(v)) && v !== null && v !== "")
        );
        if (numLike.length >= Math.max(5, Math.floor(sample.length * 0.6)))
          numericCol = col.name;
      }
    }
    if (!categoricalCol) {
      const sample = data.slice(0, 50).map((r) => r[col.name]);
      const uniqueCount = new Set(
        sample.filter((v) => v !== null && v !== undefined && v !== "")
      ).size;
      if (uniqueCount > 1 && uniqueCount <= 20) {
        categoricalCol = col.name;
      }
    }
    if (numericCol && categoricalCol) break;
  }

  return { numericCol, categoricalCol };
};

// Build histogram for one numeric column
const buildHistogram = (values: number[], bins = 12) => {
  if (!values.length) return [] as { bin: string; count: number }[];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = range / bins;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[idx] += 1;
  });
  return counts.map((c, i) => ({
    bin: `${(min + i * width).toFixed(1)}–${(min + (i + 1) * width).toFixed(
      1
    )}`,
    count: c,
  }));
};

// Build bar counts for a categorical column
const buildCategoryCounts = (values: any[], topN = 15) => {
  const map = new Map<string, number>();
  for (const v of values) {
    const key =
      v === null || v === undefined || v === "" ? "(blank)" : String(v);
    map.set(key, (map.get(key) || 0) + 1);
  }
  const arr = Array.from(map.entries()).map(([name, value]) => ({
    name,
    value,
  }));
  arr.sort((a, b) => b.value - a.value);
  return arr.slice(0, topN);
};

// Correlation matrix (Pearson) for numeric columns
const pearson = (xs: number[], ys: number[]) => {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return 0;
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const vx = x[i] - mx;
    const vy = y[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy) || 1;
  return num / denom;
};

const buildCorrelation = (columns: Column[], data: Row[]) => {
  const numericNames = columns
    .map((c) => c.name)
    .filter((name) => {
      const sample = data.slice(0, 50).map((r) => r[name]);
      const nums = sample.filter(
        (v) =>
          isNumber(v) ||
          (!Number.isNaN(Number(v)) && v !== null && v !== "")
      );
      return nums.length >= Math.max(5, Math.floor(sample.length * 0.6));
    });

  const series: Record<string, number[]> = {};
  numericNames.forEach((name) => {
    series[name] = data
      .map((r) => r[name])
      .map((v) => (isNumber(v) ? Number(v) : Number(v)))
      .filter((v) => !Number.isNaN(v));
  });

  const matrix: number[][] = [];
  for (let i = 0; i < numericNames.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < numericNames.length; j++) {
      const xi = series[numericNames[i]] || [];
      const yj = series[numericNames[j]] || [];
      const len = Math.min(xi.length, yj.length);
      matrix[i][j] = len ? pearson(xi.slice(0, len), yj.slice(0, len)) : 0;
    }
  }
  return { numericNames, matrix };
};

// Data Quality Score (simple heuristic) — returns integer 0..100
const computeQualityScore = (
  summary: DataSummary | null | undefined,
  dataset: Dataset | null
): number => {
  try {
    if (
      !summary ||
      !dataset ||
      !Array.isArray(dataset.columns) ||
      dataset.columns.length === 0
    ) {
      return 0;
    }

    const { missingValues = 0, duplicates = 0, totalRows = 0 } = summary || {};
    const totalColumns = dataset.columns.length;

    if (totalRows <= 0 || totalColumns <= 0) {
      return 0;
    }

    const totalCells = totalRows * totalColumns;

    const missingPenalty =
      totalCells > 0
        ? Math.min(1, Math.max(0, missingValues / totalCells)) * 0.9
        : 0;

    const dupPenalty =
      totalRows > 0
        ? Math.min(1, Math.max(0, duplicates / totalRows)) * 0.5
        : 0;

    let score = 100 * (1 - (missingPenalty + dupPenalty));
    score = Math.max(0, Math.min(100, Math.round(score)));
    return Number.isFinite(score) ? score : 0;
  } catch (error) {
    console.error("Error calculating quality score:", error);
    return 0;
  }
};

const ProgressBar: React.FC<{ value: number }> = memo(({ value }) => {
  const safeValue = useMemo(
    () =>
      Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value)))
        : 0,
    [value]
  );

  const widthStyle = useMemo(
    () => ({
      width: `${safeValue}%`,
      minWidth: safeValue > 0 ? "6px" : "0px",
    }),
    [safeValue]
  );

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
      className="w-full rounded-full border border-gray-700/60 bg-gray-900/40 p-1"
    >
      <motion.div
        key={`progress-${safeValue}`}
        initial={{ width: 0 }}
        animate={widthStyle}
        transition={{
          type: "spring",
          stiffness: 120,
          damping: 20,
          duration: 0.5,
        }}
        className="h-3 rounded-full bg-green-500"
      />
    </div>
  );
});

const StatCard: React.FC<{
  title: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
}> = React.memo(({ title, value, icon: Icon, accent }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className={`mt-1 text-3xl font-bold ${accent}`}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
        </div>
        <Icon className={`h-8 w-8 ${accent}`} />
      </div>
    </motion.div>
  );
});

// Sort helper
const sortRows = (rows: Row[], key: string, dir: "asc" | "desc") => {
  const sorted = [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (isNumber(va) && isNumber(vb))
      return dir === "asc"
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number);
    const sa = String(va ?? "").toLowerCase();
    const sb = String(vb ?? "").toLowerCase();
    if (sa < sb) return dir === "asc" ? -1 : 1;
    if (sa > sb) return dir === "asc" ? 1 : -1;
    return 0;
  });
  return sorted;
};

// -----------------------
// Main Component
// -----------------------

const Overview: React.FC = () => {
  const { dataset, dataSummary, fetchPreview } = useDataContext();

  // Data state
  const [sortBy, setSortBy] = useState<{
    key: string | null;
    dir: "asc" | "desc";
  }>({
    key: null,
    dir: "asc",
  });
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // NEW: preview + row limit state
  const [previewData, setPreviewData] = useState<Row[] | null>(null);
  const [rowLimit, setRowLimit] = useState<number>(50);

  // Quality score calculation
  const quality = useMemo(
    () => computeQualityScore(dataSummary, dataset as Dataset | null),
    [
      dataSummary?.missingValues,
      dataSummary?.duplicates,
      dataSummary?.totalRows,
      dataset?.columns?.length,
    ]
  );

  // Correlation data
  const { numericNames, matrix } = useMemo(() => {
    if (!dataset?.data || !dataset.columns) {
      return { numericNames: [] as string[], matrix: [] as number[][] };
    }
    return buildCorrelation(dataset.columns as Column[], dataset.data as Row[]);
  }, [dataset]);

  // Memoized data
  const cleanedRows = useMemo<Row[]>(
    () => ((dataset?.data as Row[]) || []),
    [dataset?.data]
  );
  const columns = useMemo<Column[]>(
    () => ((dataset?.columns as Column[]) || []),
    [dataset?.columns]
  );

  // FIX: allow modifiedColumns even if not in context Dataset type
  const modifiedSet = useMemo(
    () =>
      new Set<string>(
        ((dataset as unknown as { modifiedColumns?: string[] })
          ?.modifiedColumns) || []
      ),
    [dataset]
  );

  // Fetch preview data when dataset or rowLimit changes
  useEffect(() => {
    const loadPreview = async () => {
      if (!dataset?.id) {
        setPreviewData(dataset?.data as Row[] || []);
        return;
      }

      try {
        let data: Row[] = [];
        
        // If rowLimit is -1, use the full dataset if available
        if (rowLimit === -1 && dataset.data) {
          data = dataset.data as Row[];
        } else {
          // Fetch preview data with the specified row limit
          const limit = rowLimit > 0 ? rowLimit : 50; // Default to 50 if rowLimit is 0 or invalid
          const preview = await fetchPreview(dataset.id, limit);
          
          // Handle different response formats
          if (Array.isArray(preview)) {
            data = preview;
          } else if (preview && Array.isArray(preview.data)) {
            data = preview.data;
          } else if (preview && Array.isArray(preview.rows)) {
            data = preview.rows;
          } else if (dataset.data) {
            // Fallback to dataset data if preview format is unexpected
            data = dataset.data as Row[];
          }
        }
        
        setPreviewData(data);
      } catch (err) {
        console.error("Failed to load dataset preview:", err);
        // Fallback to full dataset if preview fails
        setPreviewData(dataset.data as Row[] || []);
      }
    };
    
    loadPreview();
  }, [dataset, rowLimit, fetchPreview]);

  // Effective rows: choose preview if available, then apply sorting
  const effectiveRows = useMemo(() => {
    const baseRows =
      previewData && previewData.length > 0 ? previewData : cleanedRows;
    let rows = baseRows;
    if (sortBy.key) rows = sortRows(rows, sortBy.key, sortBy.dir);
    return rows;
  }, [cleanedRows, previewData, sortBy]);

  const onSort = useCallback((key: string) => {
    setSortBy((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  }, []);

  // Charts data: types & missing
  const { typesPie, missingCols, maxMissing } = useMemo(() => {
    const typeMap: Record<string, number> = {};
    columns.forEach((c) => {
      const t = c.type || "Unknown";
      typeMap[t] = (typeMap[t] || 0) + 1;
    });
    const total = Object.values(typeMap).reduce((s, v) => s + v, 0) || 1;
    const typesPie = Object.entries(typeMap).map(([name, value]) => ({
      name,
      value,
      pct: ((value / total) * 100).toFixed(1),
    }));

    const missingCols = columns
      .filter((c) => (c.missingCount ?? 0) > 0)
      .map((c) => ({
        ...c,
        highlight: selectedType ? c.type === selectedType : true,
      }));

    const maxMissing = Math.max(
      0,
      ...missingCols.map((c) => c.missingCount || 0)
    );
    return { typesPie, missingCols, maxMissing };
  }, [columns, selectedType]);

  // Quick charts: numeric histogram & categorical bar
  const { numericCol, categoricalCol } = useMemo(
    () => pickQuickColumns(columns, cleanedRows),
    [columns, cleanedRows]
  );

  const histogramData = useMemo(() => {
    if (!numericCol) return [];
    const nums = cleanedRows
      .map((r) => r[numericCol])
      .map((v) => (isNumber(v) ? Number(v) : Number(v)))
      .filter((v) => !Number.isNaN(v));
    return buildHistogram(nums, 12);
  }, [cleanedRows, numericCol]);

  const categoryData = useMemo(() => {
    if (!categoricalCol) return [];
    return buildCategoryCounts(cleanedRows.map((r) => r[categoricalCol]));
  }, [cleanedRows, categoricalCol]);

  // Quality Issues block
  const renderQualityIssues = useCallback(() => {
    if (!dataSummary || !dataset) return null;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-4"
      >
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-300">
            Quality Loss Breakdown:
          </h4>
          {(() => {
            // Use recalculated metrics if data has been cleaned
            let metrics = dataSummary;
            if (dataset && (dataset.updatedAt || (dataset as any).forced)) {
              const totalRows = dataset.data?.length ?? 0;
              const totalColumns = dataset.columns?.length ?? 0;
              let missingValues = 0;
              let duplicates = 0;

              if (dataset.data) {
                for (const row of dataset.data as Row[]) {
                  for (const value of Object.values(row)) {
                    if (
                      value === null ||
                      value === undefined ||
                      value === "" ||
                      value === "null"
                    ) {
                      missingValues++;
                    }
                  }
                }
              }

              if (dataset.data) {
                const rowStrings = (dataset.data as Row[]).map((row) =>
                  JSON.stringify(row)
                );
                const uniqueRows = new Set(rowStrings);
                duplicates = (dataset.data as Row[]).length - uniqueRows.size;
              }

              metrics = {
                ...dataSummary,
                totalRows,
                totalColumns,
                missingValues,
                duplicates,
              };
            }

            const totalRows =
              metrics.totalRows ??
              (dataset.data as Row[] | undefined)?.length ??
              0;
            const totalColumns =
              metrics.totalColumns ?? dataset.columns?.length ?? 0;
            const totalCells = totalRows * totalColumns;
            const missing = metrics.missingValues ?? 0;
            const duplicates = metrics.duplicates ?? 0;

            const missingPenalty =
              totalCells > 0 ? (missing / totalCells) * 0.9 * 100 : 0;
            const duplicatePenalty =
              totalRows > 0 ? (duplicates / totalRows) * 0.5 * 100 : 0;
            const totalQualityLoss = missingPenalty + duplicatePenalty;

            if (totalQualityLoss === 0) {
              return (
                <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 p-2">
                  <TrendingUp className="h-4 w-4 text-green-400" />
                  <span className="text-sm text-green-300">
                    No quality issues detected
                  </span>
                </div>
              );
            }

            return (
              <>
                {missing > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-400" />
                      <span className="text-sm text-yellow-300">
                        {missing} missing values
                      </span>
                    </div>
                    <span className="text-xs text-yellow-400">
                      {missingPenalty.toFixed(1)}%
                    </span>
                  </div>
                )}
                {duplicates > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-orange-500/10 border border-orange-500/30 p-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-400" />
                      <span className="text-sm text-orange-300">
                        {duplicates} duplicate rows
                      </span>
                    </div>
                    <span className="text-xs text-orange-400">
                      {duplicatePenalty.toFixed(1)}%
                    </span>
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-2">
                  Total quality loss: {totalQualityLoss.toFixed(1)}% (100% -{" "}
                  {quality || 0}% = {(100 - (quality || 0)).toFixed(1)}%)
                </div>
              </>
            );
          })()}
        </div>
      </motion.div>
    );
  }, [dataSummary, dataset, quality]);

  if (!dataset || !columns.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700/60 bg-gray-900/40 p-8 text-center text-gray-400">
        <Database className="mx-auto mb-3 h-10 w-10 text-gray-600" />
        <p className="text-lg font-semibold text-gray-200">
          No dataset loaded
        </p>
        <p className="text-sm text-gray-400 mt-1">
          Upload a dataset to see the overview, quality metrics, and smart
          insights.
        </p>
      </div>
    );
  }

  const totalRows = dataSummary?.totalRows ?? dataset.data.length ?? 0;
  const totalColumns = dataSummary?.totalColumns ?? dataset.columns.length ?? 0;
  const missingValues = dataSummary?.missingValues ?? 0;
  // const duplicateRows = dataSummary?.duplicates ?? 0;

  return (
    <div className="space-y-6">
      {/* Header + KPI cards */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <Database className="h-6 w-6 text-sky-400" />
            <h2 className="text-2xl font-semibold text-white">Overview</h2>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Quick summary of your dataset, data quality, and automatic insights.
          </p>
          {dataset.name && (
            <p className="mt-1 text-xs text-gray-500">
              Dataset: <span className="text-gray-300">{dataset.name}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 w-full lg:w-auto">
          <StatCard
            title="Rows"
            value={totalRows}
            icon={Users}
            accent="text-blue-400"
          />
          <StatCard
            title="Columns"
            value={totalColumns}
            icon={BarChart3}
            accent="text-emerald-400"
          />
          <StatCard
            title="Missing Values"
            value={missingValues}
            icon={AlertTriangle}
            accent="text-amber-400"
          />
          <div className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-400">Quality Score</p>
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold text-emerald-400">
                {quality}%
              </span>
              <div className="flex-1">
                <ProgressBar value={quality} />
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Quality Issues */}
      {renderQualityIssues()}

      {/* Core Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Column Types Distribution */}
        <motion.div
          initial={{ opacity: 0, x: -15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
        >
          <h3 className="mb-4 flex items-center text-xl font-semibold text-white">
            <PieChartIcon className="mr-2 h-5 w-5 text-purple-400" /> Column
            Types Distribution
          </h3>
          {typesPie.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={typesPie}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  dataKey="value"
                  paddingAngle={5}
                  label={({ name, payload }) =>
                    `${name} (${payload?.pct}%)`
                  }
                  onClick={(d) =>
                    setSelectedType((prev) =>
                      prev === (d?.name as string)
                        ? null
                        : (d?.name as string)
                    )
                  }
                  cursor="pointer"
                >
                  {typesPie.map((e, i) => (
                    <Cell
                      key={i}
                      fill={PALETTE[i % PALETTE.length] || genColor(i)}
                      stroke={selectedType === e.name ? "#fff" : "none"}
                      strokeWidth={selectedType === e.name ? 3 : 0}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const p = payload[0].payload as any;
                    return (
                      <div className="rounded border border-gray-600 bg-gray-900 p-2 text-sm text-white shadow-lg">
                        <p className="font-semibold">{p.name}</p>
                        <p>Count: {p.value}</p>
                        <p>Percentage: {p.pct}%</p>
                      </div>
                    );
                  }}
                />
                <Legend iconType="circle" />
              </RechartsPieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400">
              No column type data available
            </p>
          )}
        </motion.div>

        {/* Missing Values by Column */}
        <motion.div
          initial={{ opacity: 0, x: 15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
        >
          <h3 className="mb-4 flex items-center text-xl font-semibold text-white">
            <TrendingUp className="mr-2 h-5 w-5 text-green-400" /> Missing
            Values by Column
          </h3>
          {missingCols.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={missingCols}
                margin={{ top: 5, right: 20, left: -10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="name"
                  stroke="#9CA3AF"
                  fontSize={12}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis stroke="#9CA3AF" />
                <Tooltip
                  cursor={{ fill: "rgba(107,114,128,0.1)" }}
                  content={({ payload }) => {
                    if (!payload?.length) return null;
                    const p = payload[0].payload as any;
                    return (
                      <div className="rounded border border-gray-600 bg-gray-900 p-2 text-sm text-white shadow-lg">
                        <p className="font-semibold">{p.name}</p>
                        <p>Missing: {p.missingCount}</p>
                        <p>Type: {p.type}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="missingCount">
                  {missingCols.map((c, idx) => {
                    const isMax =
                      c.missingCount === maxMissing && c.highlight;
                    const fill = isMax
                      ? "#F87171"
                      : c.highlight
                      ? "#FBBF24"
                      : "#4B5563";
                    return <Cell key={idx} fill={fill} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[300px] items-center justify-center">
              <p className="text-center text-gray-400">
                No missing values found in the dataset! ✨
              </p>
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick Auto Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Numeric Histogram */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
        >
          <h3 className="mb-1 text-lg font-semibold text-white">
            {numericCol ? `Histogram: ${numericCol}` : "Histogram"}
          </h3>
          <p className="mb-3 text-xs text-gray-400">
            Auto-selected numeric column
          </p>
          {histogramData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="bin"
                  stroke="#9CA3AF"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="#9CA3AF" />
                <Tooltip />
                <Bar dataKey="count" fill="#60A5FA" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-gray-400">
              No numeric column detected
            </div>
          )}
        </motion.div>

        {/* Categorical Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
        >
          <h3 className="mb-1 text-lg font-semibold text-white">
            {categoricalCol
              ? `Top Categories: ${categoricalCol}`
              : "Top Categories"}
          </h3>
          <p className="mb-3 text-xs text-gray-400">
            Auto-selected categorical column
          </p>
          {categoryData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="name"
                  stroke="#9CA3AF"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="#9CA3AF" />
                <Tooltip />
                <Bar dataKey="value">
                  {categoryData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={PALETTE[i % PALETTE.length] || genColor(i)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-gray-400">
              No categorical column detected
            </div>
          )}
        </motion.div>
      </div>

      {/* Correlation Heatmap */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
      >
        <h3 className="mb-1 text-lg font-semibold text-white">
          Correlation Heatmap
        </h3>
        <p className="mb-4 text-xs text-gray-400">
          Numeric columns only – Pearson correlation
        </p>
        {numericNames.length >= 2 ? (
          <div className="overflow-auto">
            <div className="inline-block min-w-[600px]">
              {/* Header */}
              <div
                className="ml-24 grid"
                style={{
                  gridTemplateColumns: `repeat(${numericNames.length}, minmax(80px, 1fr))`,
                }}
              >
                {numericNames.map((n) => (
                  <div
                    key={n}
                    className="px-2 pb-2 text-center text-xs text-gray-300"
                  >
                    {n}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-y-1">
                {numericNames.map((rowName, i) => (
                  <div key={rowName} className="contents">
                    <div className="sticky left-0 z-10 mr-2 w-24 truncate bg-gray-800/40 px-2 py-1 text-right text-xs text-gray-300">
                      {rowName}
                    </div>
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${numericNames.length}, minmax(80px, 1fr))`,
                      }}
                    >
                      {numericNames.map((colName, j) => {
                        const v = matrix[i]?.[j] ?? 0;
                        const hue = v < 0 ? 0 : 150;
                        const alpha = Math.min(1, Math.abs(v));
                        const bg = `hsla(${hue},70%,45%,${alpha})`;
                        return (
                          <div
                            key={colName}
                            className="m-0.5 rounded-md p-2 text-center text-xs text-white"
                            style={{ background: bg }}
                          >
                            {v.toFixed(2)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-[220px] items-center justify-center text-gray-400">
            Not enough numeric columns to compute correlation
          </div>
        )}
      </motion.div>

      {/* Data Preview */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold text-white">Data Preview</h3>
            {selectedType && (
              <div className="flex items-center gap-2 rounded-full bg-blue-900/50 px-3 py-1 text-sm text-blue-200">
                <span>Filtered by type: {selectedType}</span>
                <button
                  onClick={() => setSelectedType(null)}
                  className="ml-1 rounded-full p-0.5 hover:bg-blue-800/50"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {/* Row limit dropdown */}
          <div className="flex items-center gap-2 text-xs text-gray-300">
            <span>Show:</span>
            <select
              className="rounded-md border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={rowLimit}
              onChange={(e) => {
                const val = Number(e.target.value);
                setRowLimit(val);
              }}
            >
              <option value={10}>10 Rows</option>
              <option value={25}>25 Rows</option>
              <option value={50}>50 Rows</option>
              <option value={100}>100 Rows</option>
              <option value={500}>500 Rows</option>
              <option value={-1}>All Rows</option>
            </select>
            {previewData && (
              <span className="text-[10px] text-gray-500">
                Showing {effectiveRows.length} row{effectiveRows.length === 1 ? "" : "s"}
                {rowLimit === -1 ? " (all)" : " (preview)"}
              </span>
            )}
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-700/30 text-gray-300">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.name}
                    className="sticky top-0 z-10 cursor-pointer border-b border-gray-700 px-3 py-2 backdrop-blur hover:bg-gray-700/40"
                    onClick={() => onSort(col.name)}
                    title="Click to sort"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{col.name}</span>
                      {modifiedSet.has(col.name) && (
                        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      )}
                      <span className="text-[10px] text-purple-300">
                        {col.type || ""}
                      </span>
                      {sortBy.key === col.name && (
                        <span className="text-[10px] text-gray-400">
                          {sortBy.dir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {effectiveRows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-gray-800 hover:bg-gray-700/20"
                >
                  {columns.map((col) => (
                    <td
                      key={col.name}
                      className={`whitespace-nowrap px-3 py-2 text-gray-200 ${
                        modifiedSet.has(col.name) ? "bg-purple-500/5" : ""
                      }`}
                    >
                      {renderCell(row[col.name])}
                    </td>
                  ))}
                </tr>
              ))}
              {!effectiveRows.length && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-4 text-center text-gray-500 text-sm"
                  >
                    No rows to display for this preview.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* AI Suggestions section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="rounded-xl border border-gray-700/60 bg-gray-800/40 p-5"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          <h3 className="text-lg font-semibold text-white">Smart Suggestions</h3>
        </div>
        <ul className="list-disc space-y-1 pl-6 text-sm text-gray-300">
          {/* You can fill this list with AI suggestions based on summary/quality */}
        </ul>
      </motion.div>
    </div>
  );
};

export default Overview;
