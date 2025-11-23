// DataContext.tsx
import React, { 
  createContext, 
  useContext, 
  useState, 
  useEffect, 
  ReactNode, 
  useCallback 
} from "react";
import { unstable_batchedUpdates } from 'react-dom';
import { Dataset, DataSummary, AIInsight, ColumnInfo } from "../types";
import { generateAIInsights, analyzeColumns } from "../utils/dataProcessor";

// Utility function to calculate metrics from dataset
const calculateMetricsFromData = (dataset: Dataset | null): DataSummary | null => {
  if (!dataset || !dataset.data || !dataset.columns) {
    return null;
  }

  const totalRows = dataset.data.length;
  if (totalRows === 0) {
    return {
      totalRows: 0,
      totalColumns: dataset.columns.length,
      missingValues: 0,
      duplicates: 0,
      memoryUsage: '0 B'
    };
  }

  const totalColumns = dataset.columns.length;
  let missingValues = 0;
  const columnNames = dataset.columns.map(col => col.name);
  
  // Calculate missing values and track unique rows
  const rowHashes = new Set<string>();
  const rowValues: Record<string, any>[] = [];
  
  for (const row of dataset.data) {
    const rowData: Record<string, any> = {};
    let rowHasAllNulls = true;
    
    for (const colName of columnNames) {
      const value = row[colName];
      const isMissing = value === null || value === undefined || value === '' || value === 'null';
      
      if (isMissing) {
        missingValues++;
      } else {
        rowHasAllNulls = false;
      }
      
      rowData[colName] = value;
    }
    
    // Skip all-null rows when calculating duplicates
    if (!rowHasAllNulls) {
      const rowString = JSON.stringify(rowData);
      rowHashes.add(rowString);
      rowValues.push(rowData);
    }
  }

  // Calculate memory usage approximation
  const memoryUsage = (function() {
    const size = new Blob([JSON.stringify(dataset.data)]).size;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  })();

  // Calculate duplicates based on unique row hashes
  const duplicates = dataset.data.length - rowHashes.size;

  return {
    totalRows,
    totalColumns,
    missingValues,
    duplicates,
    memoryUsage
  };
};

// 🔹 API base URL from env
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

interface DataContextType {
  rawDataset: Dataset | null;
  dataset: Dataset | null;
  dataSummary: DataSummary | null;
  aiInsights: AIInsight[];
  isLoading: boolean;
  setDataset: (dataset: Dataset | null) => void;
  setRawDataset: (dataset: Dataset | null) => void;
  setDataSummary: (summary: DataSummary | null) => void;
  setAIInsights: (insights: AIInsight[]) => void;
  setIsLoading: (loading: boolean) => void;
  updateCleanedData: (cleanedData: any[], columns?: ColumnInfo[] | Array<{ name: string }>, summary?: DataSummary) => void;
  forceDatasetUpdate: (newData: any[]) => void;
  updateCounter: number;
  fetchDatasets: () => Promise<Dataset[]>;
  fetchPreview: (datasetId: string, limit?: number) => Promise<any | null>;
  fetchSummary: (datasetId: string) => Promise<DataSummary | null>;
  uploadDataset: (file: File) => Promise<Dataset | null>;
  fetchDatasetPreview: (datasetId: string, limit?: number) => Promise<any | null>; // ✅ added
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const useDataContext = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useDataContext must be used within a DataProvider");
  }
  return context;
};

interface DataProviderProps {
  children: ReactNode;
}

export const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
  const [rawDataset, setRawDataset] = useState<Dataset | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [aiInsights, setAIInsights] = useState<AIInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialUpload, setIsInitialUpload] = useState(true);
  const [updateCounter, setUpdateCounter] = useState(0);
  
  // Memoize the dataset to prevent unnecessary re-renders
  const memoizedDataset = React.useMemo(() => dataset, [dataset]);

  // 🔹 Update cleaned data - ensures consistency across components
  const updateCleanedData = useCallback((cleanedData: any[], columns?: ColumnInfo[] | Array<{ name: string }>, summary?: DataSummary) => {
    if (!dataset) {
      console.warn('⚠️ Cannot update cleaned data: no dataset available');
      return;
    }
    
    // Process columns if provided, otherwise use existing columns
    const processedColumns: ColumnInfo[] = columns 
      ? columns.map(col => ({
          name: col.name,
          type: (col as any).type || 'string',
          missingCount: (col as any).missingCount || 0,
          uniqueCount: (col as any).uniqueCount || 0
        }))
      : [...dataset.columns];
    
    // Create updated dataset with proper typing
    const updatedDataset: Dataset = { 
      ...dataset,
      data: [...cleanedData],
      columns: processedColumns,
      updatedAt: new Date()
    };
    
    // Calculate new summary if not provided
    const newSummary = summary || calculateMetricsFromData(updatedDataset);
    
    // Batch state updates to prevent unnecessary re-renders
    unstable_batchedUpdates(() => {
      setDataset(updatedDataset);
      setRawDataset(updatedDataset);
      if (newSummary) {
        setDataSummary(newSummary);
      }
      setUpdateCounter(prev => prev + 1);
    });
    
    console.log('🔄 Updated dataset with cleaned data:', {
      rows: cleanedData.length,
      columns: processedColumns.length,
      summary: newSummary
    });
  }, [dataset]);

  // 🔹 Force dataset update
  const forceDatasetUpdate = useCallback((newData: any[]) => {
    if (!dataset) return;
    const forcedDataset = { 
      ...dataset, 
      data: [...newData], 
      updatedAt: new Date(), 
      forced: true 
    };
    
    unstable_batchedUpdates(() => {
      setDataset(forcedDataset);
      setRawDataset(forcedDataset);
      const newSummary = calculateMetricsFromData(forcedDataset);
      if (newSummary) {
        setDataSummary(newSummary);
      }
      setUpdateCounter(prev => prev + 1);
    });
  }, [dataset]);

  // 🔹 Wrapper for setDataset
  const handleSetDataset = useCallback((newDataset: Dataset | null) => {
    console.log('📥 handleSetDataset called:', {
      hasDataset: !!newDataset,
      isInitialUpload,
      datasetId: newDataset?.id
    });
    
    unstable_batchedUpdates(() => {
      if (newDataset && isInitialUpload) {
        console.log('🔄 Setting isInitialUpload to false');
        setIsInitialUpload(false);
      }
      
      setDataset(newDataset);
      
      // Only update raw dataset if it's a new dataset or explicitly forced
      if (!rawDataset || !newDataset || newDataset.forced) {
        setRawDataset(newDataset);
      }
      
      // Recalculate summary when dataset changes
      if (newDataset) {
        const summary = calculateMetricsFromData(newDataset);
        if (summary) {
          setDataSummary(summary);
        }
      } else {
        setDataSummary(null);
      }
    });
  }, [isInitialUpload, rawDataset]);

  // 🔹 Log dataset changes
  useEffect(() => {
    console.log('🔄 Dataset changed:', {
      id: dataset?.id,
      dataLength: dataset?.data?.length,
      updatedAt: dataset?.updatedAt,
      forced: (dataset as any)?.forced
    });
  }, [dataset]);

  // 🔹 Fetch AI insights whenever dataset changes
  useEffect(() => {
    const fetchInsights = async () => {
      if (!dataset) {
        setAIInsights([]);
        return;
      }
      setIsLoading(true);
      try {
        const columns: ColumnInfo[] = analyzeColumns(dataset.data);
        const insights = await generateAIInsights(dataset.data, columns);
        setAIInsights(insights);
      } catch (error) {
        console.error("Error generating AI insights:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInsights();
  }, [dataset]);

  // 🔹 API calls
  const fetchDatasets = async (): Promise<Dataset[]> => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/datasets`);
      if (!res.ok) throw new Error("Failed to fetch datasets");
      return await res.json();
    } catch (error) {
      console.error(error);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch preview with a default limit of 500 rows
  const fetchPreview = async (datasetId: string, limit: number = 10000): Promise<any | null> => {
    try {
      const url = `${API_BASE}/preview/${datasetId}${limit ? `?limit=${limit}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch preview: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      return data;
    } catch (error) {
      console.error('Error in fetchPreview:', error);
      return null;
    }
  };

  // ✅ New: dataset preview using /api/datasets/... and limit param
  const fetchDatasetPreview = async (
    datasetId: string,
    limit: number = 10
  ): Promise<any | null> => {
    try {
      const response = await fetch(
        `${API_BASE}/api/datasets/${datasetId}/preview?limit=${limit}`
      );
      if (!response.ok) throw new Error("Failed to fetch dataset preview");
      return await response.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const fetchSummary = async (datasetId: string): Promise<DataSummary | null> => {
    try {
      const res = await fetch(`${API_BASE}/summary/${datasetId}`);
      if (!res.ok) throw new Error("Failed to fetch summary");
      return await res.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const uploadDataset = async (file: File): Promise<Dataset | null> => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const uploaded = await res.json();
      handleSetDataset(uploaded);
      setRawDataset(uploaded);

      // Fetch the summary to get quality metrics
      if (uploaded.id) {
        try {
          const summaryRes = await fetch(`${API_BASE}/summary/${uploaded.id}`);
          if (summaryRes.ok) {
            const summary = await summaryRes.json();
            setDataSummary(summary);
            console.log('📊 Dataset summary loaded:', summary);
          }
        } catch (error) {
          console.error('Failed to fetch summary:', error);
        }
      }

      // Refresh the datasets list to show the newly uploaded file
      await fetchDatasets();
      return uploaded;
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DataContext.Provider
      value={{
        rawDataset,
        dataset,
        dataSummary,
        aiInsights,
        isLoading,
        setDataset: handleSetDataset,
        setRawDataset,
        setDataSummary,
        setAIInsights,
        setIsLoading,
        updateCleanedData,
        forceDatasetUpdate,
        updateCounter,
        fetchDatasets,
        fetchPreview,
        fetchSummary,
        uploadDataset,
        fetchDatasetPreview, // ✅ exposed in context
      }}
    >
      {children}
    </DataContext.Provider>
  );
};
