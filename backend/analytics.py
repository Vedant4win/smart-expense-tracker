import statistics
from datetime import datetime, timedelta

def run_statistical_checks(supabase, user_id: str, new_amount: float, merchant: str, category_id: str):
    """
    Executes the mathematical anomaly and duplicate detection logic
    defined in Problem Formulation Section 2.3.
    """
    is_anomaly = False
    is_duplicate = False
    
    # ---------------------------------------------------------
    # 1. Temporal Duplicate Filter (Delta t <= 120 seconds)
    # ---------------------------------------------------------
    # Look for identical transactions within the last 2 minutes
    two_mins_ago = (datetime.utcnow() - timedelta(minutes=2)).isoformat()
    
    duplicate_query = supabase.table("transactions")\
        .select("transaction_id")\
        .eq("user_id", user_id)\
        .eq("merchant_name", merchant)\
        .eq("amount", new_amount)\
        .gte("created_at", two_mins_ago)\
        .execute()
        
    if len(duplicate_query.data) > 0:
        is_duplicate = True

    # ---------------------------------------------------------
    # 2. Dynamic Contextual Z-Score (Rolling 30-Day Window)
    # ---------------------------------------------------------
    thirty_days_ago = (datetime.utcnow() - timedelta(days=30)).isoformat()
    
    # Fetch historical amounts for this specific user and category
    history_query = supabase.table("transactions")\
        .select("amount")\
        .eq("user_id", user_id)\
        .eq("category_id", category_id)\
        .gte("date", thirty_days_ago)\
        .execute()
        
    historical_amounts = [float(tx['amount']) for tx in history_query.data]
    
    # We need at least 3 historical data points to calculate a meaningful standard deviation
    if len(historical_amounts) >= 3:
        mean_val = statistics.mean(historical_amounts)
        std_dev = statistics.stdev(historical_amounts)
        
        # Prevent Division by Zero if all previous transactions were the exact same amount
        if std_dev > 0:
            # Formula: Z = |(x - mu) / sigma|
            z_score = abs((new_amount - mean_val) / std_dev)
            
            # Statistical Threshold: p < 0.01 (Z > 2.58)
            if z_score > 2.58:
                is_anomaly = True
                
    return {
        "is_anomaly": is_anomaly,
        "is_duplicate": is_duplicate
    }