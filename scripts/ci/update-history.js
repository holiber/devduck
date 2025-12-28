#!/usr/bin/env node
/**
 * Update Metrics History
 * Appends current metrics to history and maintains last 30 records
 */
import fs from 'fs';
import path from 'path';

const METRICS_DIR = '.cache/metrics';
const CURRENT_FILE = path.join(METRICS_DIR, 'current.json');
const HISTORY_FILE = path.join(METRICS_DIR, 'history.json');
const MAX_HISTORY_LENGTH = 30;

function updateHistory() {
  console.log('📜 Updating metrics history...');
  
  // Check if current metrics exist
  if (!fs.existsSync(CURRENT_FILE)) {
    console.log('⚠️  No current metrics found, skipping history update');
    return;
  }
  
  try {
    // Read current metrics
    const current = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf-8'));
    
    // Read existing history or initialize empty array
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        if (!Array.isArray(history)) {
          console.log('⚠️  Invalid history format, resetting...');
          history = [];
        }
      } catch (error) {
        console.log('⚠️  Could not parse history, resetting...');
        history = [];
      }
    }
    
    // Append current metrics
    history.push(current);
    
    // Keep only last N records
    if (history.length > MAX_HISTORY_LENGTH) {
      history = history.slice(-MAX_HISTORY_LENGTH);
      console.log(`  Trimmed to last ${MAX_HISTORY_LENGTH} records`);
    }
    
    // Save updated history
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    
    console.log(`✅ History updated (${history.length} records)`);
    
    // Print summary
    if (history.length >= 2) {
      const previous = history[history.length - 2];
      console.log('\n📊 Trend:');
      
      if (current.build_time_sec && previous.build_time_sec) {
        const diff = current.build_time_sec - previous.build_time_sec;
        const sign = diff >= 0 ? '+' : '';
        console.log(`  Build time: ${current.build_time_sec}s (${sign}${diff.toFixed(2)}s)`);
      }
      
      if (current.test_time_sec && previous.test_time_sec) {
        const diff = current.test_time_sec - previous.test_time_sec;
        const sign = diff >= 0 ? '+' : '';
        console.log(`  Test time: ${current.test_time_sec}s (${sign}${diff.toFixed(2)}s)`);
      }
      
      if (current.bundle_size_bytes && previous.bundle_size_bytes) {
        const diff = current.bundle_size_bytes - previous.bundle_size_bytes;
        const sign = diff >= 0 ? '+' : '';
        const diffKB = (diff / 1024).toFixed(2);
        console.log(`  Bundle size: ${(current.bundle_size_bytes / 1024).toFixed(2)} KB (${sign}${diffKB} KB)`);
      }
    }
  } catch (error) {
    console.error('❌ Error updating history:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateHistory();
}

export { updateHistory };
