'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../utils/supabase';
import axios from 'axios';
import { Upload, FileText, Loader2, AlertCircle, CheckCircle, LogOut, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsedData, setParsedData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Updated state to include budgetWarning
  const [saveStatus, setSaveStatus] = useState<{
    success: boolean;
    anomaly: boolean;
    budgetWarning: string | null;
  } | null>(null);
  
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const initializeData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push('/login');
          return;
        }
        setUser(session.user);

        const { data: categoryData } = await supabase
          .from('categories')
          .select('*')
          .order('name');
          
        if (categoryData && categoryData.length > 0) {
          setCategories(categoryData);
          setSelectedCategoryId(categoryData[0].category_id);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      } finally {
        setIsInitializing(false);
      }
    };
    
    initializeData();
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setParsedData(null);
      setSaveStatus(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a receipt image first.");
      return;
    }
    setLoading(true);
    setError(null);
    setSaveStatus(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/api/receipts/process`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      
      const data = response.data.parsed_data;
      setParsedData(data);
      
      const matchedCategory = categories.find(
        c => c.name.toLowerCase() === data.category.toLowerCase()
      );
      if (matchedCategory) {
        setSelectedCategoryId(matchedCategory.category_id);
      }

    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to process receipt.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!parsedData || !user || !selectedCategoryId) return;
    setSaving(true);
    setError(null);

    try {
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/api/transactions`,
        {
          user_id: user.id,
          category_id: selectedCategoryId,
          amount: parsedData.amount,
          merchant_name: parsedData.merchant,
          date: parsedData.date
        }
      );
      
      setSaveStatus({
        success: true,
        anomaly: response.data.anomaly_detected,
        budgetWarning: response.data.budget_warning
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save transaction.");
    } finally {
      setSaving(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <main className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        
        <div className="flex justify-between items-center mb-8 border-b pb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="text-blue-600" />
            Smart Expense Tracker
          </h1>
          <div className="flex gap-4 items-center">
            <Link href="/dashboard" className="text-sm text-gray-600 hover:text-blue-600 flex items-center gap-1">
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Link>
            <button onClick={handleSignOut} className="text-sm text-red-600 hover:underline flex items-center gap-1">
              <LogOut className="h-4 w-4" /> Sign Out
            </button>
          </div>
        </div>
        
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:bg-gray-50 transition-colors">
          <input 
            type="file" 
            id="receipt-upload" 
            className="hidden" 
            accept="image/*"
            onChange={handleFileChange}
          />
          <label htmlFor="receipt-upload" className="cursor-pointer flex flex-col items-center">
            <Upload className="h-10 w-10 text-gray-400 mb-3" />
            <span className="text-sm font-medium text-gray-700">
              {file ? file.name : "Click to upload a receipt"}
            </span>
            <span className="text-xs text-gray-500 mt-1">JPEG, PNG up to 5MB</span>
          </label>
        </div>

        <button 
          onClick={handleUpload}
          disabled={!file || loading || saving}
          className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-3 px-4 rounded-lg flex justify-center items-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="animate-spin h-5 w-5" /> : "Process Receipt"}
        </button>

        {error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {parsedData && !saveStatus && (
          <div className="mt-8 animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-lg font-semibold mb-4 border-b pb-2">Review Extracted Data</h2>
            
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div><span className="text-gray-500 block">Merchant</span><span className="font-medium">{parsedData.merchant}</span></div>
                <div><span className="text-gray-500 block">Date</span><span className="font-medium">{parsedData.date}</span></div>
                <div><span className="text-gray-500 block">Amount</span><span className="font-medium text-lg">${parsedData.amount.toFixed(2)}</span></div>
                <div><span className="text-gray-500 block">AI Category Guess</span><span className="font-medium text-blue-600">{parsedData.category}</span></div>
              </div>

              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Database Category</label>
                <select 
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  {categories.map((cat) => (
                    <option key={cat.category_id} value={cat.category_id}>
                      {cat.name} ({cat.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button 
              onClick={handleSave}
              disabled={saving || !selectedCategoryId}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold py-3 px-4 rounded-lg flex justify-center items-center gap-2 transition-colors"
            >
              {saving ? <Loader2 className="animate-spin h-5 w-5" /> : "Approve & Save Transaction"}
            </button>
          </div>
        )}

        {saveStatus && (
          <div className="mt-8 p-6 bg-green-50 border border-green-200 rounded-lg flex flex-col items-center text-center animate-in zoom-in-95">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <h3 className="text-lg font-bold text-green-900">Transaction Saved!</h3>
            <p className="text-sm text-green-700 mt-1">
              Anomaly Detected: {saveStatus.anomaly ? 
                <span className="font-bold text-red-600 uppercase">Yes</span> : 
                <span className="font-bold uppercase">No</span>}
            </p>
            {saveStatus.budgetWarning && (
              <div className="mt-4 p-3 bg-amber-100 border border-amber-300 rounded text-amber-900 text-sm font-semibold w-full">
                ⚠️ {saveStatus.budgetWarning}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}