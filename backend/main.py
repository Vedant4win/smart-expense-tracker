import os
import json
from google import genai
from google.genai import types
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import supabase
from datetime import datetime
from analytics import run_statistical_checks

app = FastAPI(title="Smart Expense Tracker API")
@app.get("/")
@app.head("/")
def health_check():
    return {"status": "backend is awake"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://smart-expense-tracker-three-phi.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure the modern Gemini SDK Client
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    client = None

# --- Pydantic Schemas ---
class UserCreate(BaseModel):
    email: str

class TransactionCreate(BaseModel):
    user_id: str
    category_id: str
    amount: float          # FIXED: Matches what the frontend sends
    merchant_name: str     # FIXED: Matches what the frontend sends
    date: str

# --- API Routes ---
@app.get("/")
def read_root():
    return {"status": "ok", "message": "Backend is running"}

@app.post("/api/users")
def create_user(user: UserCreate):
    try:
        response = supabase.table("users").insert({"email": user.email}).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/users")
def get_users():
    try:
        response = supabase.table("users").select("*").execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- AI Receipt Processing Route ---
@app.post("/api/receipts/process")
async def process_receipt(file: UploadFile = File(...)):
    if not client:
         raise HTTPException(status_code=500, detail="Gemini API key is not configured.")
            
    try:
        # Read the raw image bytes from the uploaded file
        image_bytes = await file.read()
        
        prompt = """
        Analyze this receipt and extract the following information strictly as a JSON object:
        {
            "merchant": "Name of the store or entity",
            "amount": Total amount as a float (numbers only),
            "tax": Tax amount as a float (if none, return 0.0),
            "date": "YYYY-MM-DD",
            "category": "One of: Food, Transport, Utilities, Retail, Other"
        }
        Return ONLY the raw JSON object. Do not include markdown formatting, backticks, or extra text.
        """
        
        # Call the Vision API using the modern genai client and updated model
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                prompt,
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=file.content_type
                )
            ]
        )
        
        # Log the raw text to the terminal for debugging
        raw_text = response.text.strip()
        print("\n--- RAW AI RESPONSE ---")
        print(raw_text)
        print("-----------------------\n")
        
        # Aggressively strip Markdown code blocks if the AI included them
        if raw_text.startswith("```json"):
            raw_text = raw_text[7:]
        elif raw_text.startswith("```"):
            raw_text = raw_text[3:]
            
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
            
        # Parse the cleaned text into a Python dictionary
        extracted_data = json.loads(raw_text.strip())
        
        return {"status": "success", "parsed_data": extracted_data}
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI failed to return valid JSON. Raw output printed in terminal.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

@app.post("/api/transactions")
def create_transaction(transaction: TransactionCreate):
    try:
        # 1. Run temporal duplicate and anomaly checks
        stats = run_statistical_checks(
            supabase=supabase,
            user_id=transaction.user_id,
            new_amount=transaction.amount,       # Maps frontend amount -> analytics new_amount
            merchant=transaction.merchant_name,  # Maps frontend merchant_name -> analytics merchant
            category_id=transaction.category_id
        )
        
        if stats.get("is_duplicate"):
            raise HTTPException(status_code=400, detail="Duplicate transaction detected within 120 seconds.")

        # 2. Insert the transaction
        data_to_insert = {
            "user_id": transaction.user_id,
            "category_id": transaction.category_id,
            "amount": transaction.amount,
            "merchant_name": transaction.merchant_name,
            "date": transaction.date,
            "is_anomaly": stats["is_anomaly"]
        }
        response = supabase.table("transactions").insert(data_to_insert).execute()

        # 3. Budget Check Logic
        tx_date = datetime.strptime(transaction.date, "%Y-%m-%d")
        month_start = tx_date.replace(day=1).strftime("%Y-%m-%d")

        budget_res = supabase.table("budgets")\
            .select("*")\
            .eq("user_id", transaction.user_id)\
            .eq("category_id", transaction.category_id)\
            .gte("month", month_start)\
            .execute()

        budget_warning = None
        if budget_res.data and len(budget_res.data) > 0:
            budget = budget_res.data[0]
            monthly_limit = float(budget["monthly_limit"])

            all_tx = supabase.table("transactions")\
                .select("amount")\
                .eq("user_id", transaction.user_id)\
                .eq("category_id", transaction.category_id)\
                .gte("date", month_start)\
                .execute()

            total_spent = sum(float(item["amount"]) for item in all_tx.data)

            if total_spent > monthly_limit:
                budget_warning = f"Budget exceeded! Total spent: ${total_spent:.2f} / Limit: ${monthly_limit:.2f}"

        return {
            "status": "success",
            "data": response.data,
            "anomaly_detected": stats["is_anomaly"],
            "budget_warning": budget_warning
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/transactions")
def get_transactions(user_id: str):
    try:
        response = supabase.table("transactions")\
            .select("*")\
            .eq("user_id", user_id)\
            .order("created_at", desc=True)\
            .execute()
            
        return {"status": "success", "data": response.data}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.get("/api/insights")
def get_spending_insights(user_id: str):
    if not client:
        raise HTTPException(status_code=500, detail="Gemini API key is not configured.")
    
    try:
        # Fetch the user's recent transactions
        response = supabase.table("transactions")\
            .select("amount, merchant_name, date")\
            .eq("user_id", user_id)\
            .order("date", desc=True)\
            .limit(30)\
            .execute()
            
        txs = response.data
        if not txs or len(txs) == 0:
            return {"status": "success", "insights": "Add a few receipts so I can analyze your spending habits!"}
            
        # Format the transactions into a clean list for the prompt
        tx_list = "\n".join([f"- {t['date']}: ${t['amount']} at {t['merchant_name']}" for t in txs])
        
        prompt = f"""
        You are a smart, analytical financial assistant. Review the following recent transactions for this user:
        
        {tx_list}
        
        Write a concise, 2-to-3 sentence summary of their spending habits based on where their money is going, and offer one quick, actionable piece of financial advice. Keep the tone professional but encouraging. Do not use bolding or markdown formatting.
        """
        
        # Ask Gemini to analyze the habits
        ai_response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        
        return {"status": "success", "insights": ai_response.text.strip()}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.delete("/api/transactions/{transaction_id}")
def delete_transaction(transaction_id: str):
    try:
        response = supabase.table("transactions")\
            .delete()\
            .eq("transaction_id", transaction_id)\
            .execute()
            
        return {"status": "success", "message": "Transaction deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))