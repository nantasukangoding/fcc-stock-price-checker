'use strict';

const fetch = require('node-fetch');
const mongoose = require('mongoose');
const crypto = require('crypto');

// Connect to Database
mongoose.connect(process.env.DB, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true, 
  useFindAndModify: false 
});

// Define Schema
const stockSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  likes: { type: [String], default: [] } // Array of hashed IPs
});

const Stock = mongoose.model('Stock', stockSchema);

module.exports = function (app) {

  // Helper: Anonymize IP
  const anonymizeIP = (ip) => {
    return crypto.createHash('sha256').update(ip).digest('hex');
  }

  // Helper: Fetch Stock Price
  const getStockPrice = async (symbol) => {
    const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      // Check if symbol is valid (API returns "Unknown symbol" string usually if invalid, or latestPrice is null)
      if (!data.latestPrice) return null;
      return data.latestPrice;
    } catch (err) {
      console.error("Error fetching stock:", err);
      return null;
    }
  };

  // Helper: Process single stock DB update
  const processStock = async (symbol, like, ip) => {
    const safeSymbol = symbol.toUpperCase();
    let stockDoc = await Stock.findOne({ symbol: safeSymbol });
    
    if (!stockDoc) {
      stockDoc = new Stock({ symbol: safeSymbol });
    }

    if (like && ip) {
      const anonymized = anonymizeIP(ip);
      // Add IP if not already present
      if (!stockDoc.likes.includes(anonymized)) {
        stockDoc.likes.push(anonymized);
      }
    }
    
    await stockDoc.save();
    return stockDoc;
  };

  app.route('/api/stock-prices')
    .get(async function (req, res){
      let { stock, like } = req.query;
      const ip = req.ip; // Express handles getting the IP
      const isLike = like === 'true';

      // Ensure stock is an array for consistent handling
      const symbols = Array.isArray(stock) ? stock : [stock];

      // Process all requested stocks
      const stockData = [];
      
      for (let sym of symbols) {
        const price = await getStockPrice(sym);
        const dbData = await processStock(sym, isLike, ip);
        
        stockData.push({
          stock: dbData.symbol,
          price: price, // price fetched from API
          likes: dbData.likes.length
        });
      }

      // If single stock
      if (stockData.length === 1) {
        res.json({ stockData: stockData[0] });
      } 
      // If two stocks
      else if (stockData.length === 2) {
        // Calculate relative likes
        const rel1 = stockData[0].likes - stockData[1].likes;
        const rel2 = stockData[1].likes - stockData[0].likes;

        res.json({
          stockData: [
            { stock: stockData[0].stock, price: stockData[0].price, rel_likes: rel1 },
            { stock: stockData[1].stock, price: stockData[1].price, rel_likes: rel2 }
          ]
        });
      } else {
        res.status(400).send("Invalid request");
      }
    });
    
};