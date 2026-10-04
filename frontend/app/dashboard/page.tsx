'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { LayoutDashboard, AlertTriangle, ArrowLeft, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '../../utils/supabase';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Dashboard() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [insights, setInsights] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // 1. Define fetchTransactions outside useEffect so it can be reused by handleDelete
  const fetchTransactions = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      // Fetch transactions
      const response = await axios.get(
        `${process.env.NEXT_PUBLIC_API_URL}/api/transactions?user_id=${session.user.id}`
      );
      const txs = response.data.data;
      setTransactions(txs);

      // Group spend by date for the chart
      const grouped: { [key: string]: number } = {};
      txs.forEach((tx: any) => {
        grouped[tx.date] = (grouped[tx.date] || 0) + Number(tx.amount);
      });

      const formatted = Object.keys(grouped).map(date => ({
        date,
        amount: parseFloat(grouped[date].toFixed(2))
      })).reverse();

      setChartData(formatted);
      
      // Fetch AI Insights
      try {
        const insightsResponse = await axios.get(
          `${process.env.NEXT_PUBLIC_API_URL}/api/insights?user_id=${session.user.id}`
        );
        setInsights(insightsResponse.data.insights);
      } catch (insightErr) {
        console.error("Failed to fetch insights", insightErr);
      }

    } catch (err: any) {
      setError("Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  };

  // 2. Call fetchTransactions when the component mounts
  useEffect(() => {
    fetchTransactions();
  }, [router]);

  // 3. Define handleDelete (now properly scoped)
  const handleDelete = async (transactionId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this expense?");
    if (!confirmDelete) return;

    try {
      await axios.delete(`${process.env.NEXT_PUBLIC_API_URL}/api/transactions/${transactionId}`);
      fetchTransactions(); // Immediately refreshes the chart and table data
    } catch (error) {
      console.error("Failed to delete transaction", error);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 p-8 space-y-8">
        
        <div className="flex justify-between items-center border-b pb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutDashboard className="text-blue-600" />
            Expense Dashboard
          </h1>
          <Link href="/" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to Scanner
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-500 animate-pulse">Loading data...</div>
        ) : error ? (
          <div className="text-red-500 text-center py-10">{error}</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10 text-gray-500">No transactions found for this account.</div>
        ) : (
          <>
            {/* AI Insights Banner */}
            {insights && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100 mb-8">
                <h2 className="text-md font-semibold text-blue-900 mb-2 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-600" /> AI Spending Analysis
                </h2>
                <p className="text-blue-800 text-sm leading-relaxed">
                  {insights}
                </p>
              </div>
            )}

            {/* Spending Chart */}
            <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
              <h2 className="text-md font-semibold text-gray-700 mb-4">Spending Over Time</h2>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(val) => `$${val}`} />
                    <Tooltip formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Total Spent']} />
                    <Bar dataKey="amount" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Transactions Table */}
            <div className="overflow-x-auto">
              <h2 className="text-md font-semibold text-gray-700 mb-4">Recent Transactions</h2>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-sm border-b border-gray-200">
                    <th className="p-4 font-semibold rounded-tl-lg">Date</th>
                    <th className="p-4 font-semibold">Merchant</th>
                    <th className="p-4 font-semibold">Amount</th>
                    <th className="p-4 font-semibold">Status</th>
                    {/* Added a 5th column header for the delete button to keep the table aligned */}
                    <th className="p-4 font-semibold rounded-tr-lg text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.transaction_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="p-4 text-sm text-gray-600">{tx.date}</td>
                      <td className="p-4 font-medium">{tx.merchant_name}</td>
                      <td className="p-4 font-semibold">${Number(tx.amount).toFixed(2)}</td>
                      <td className="p-4">
                        {tx.is_anomaly ? (
                          <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full">
                            <AlertTriangle className="h-3 w-3" /> Anomaly
                          </span>
                        ) : (
                          <span className="inline-flex items-center bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1 rounded-full">
                            Normal
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          onClick={() => handleDelete(tx.transaction_id)}
                          className="p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 rounded-md transition-colors"
                          title="Delete Expense"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}