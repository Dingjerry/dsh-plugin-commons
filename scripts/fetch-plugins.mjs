#!/usr/bin/env node

/**
 * fetch-plugins.mjs - Fetch DSH plugins from GitHub and save to local data
 * 
 * Usage: node scripts/fetch-plugins.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(process.cwd(), 'data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'plugins.json');
const INDEX_FILE = join(OUTPUT_DIR, 'plugins-index.json');

async function fetchPlugins(page = 1, perPage = 100, maxPages = 10) {
  const allPlugins = [];
  
  for (let p = 1; p <= maxPages; p++) {
    const url = `https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=stars&order=desc&page=${p}&per_page=${perPage}`;
    
    console.log(`Fetching page ${p}...`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        }
      });
      
      if (!response.ok) {
        console.error(`Error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        console.log('No more results.');
        break;
      }
      
      allPlugins.push(...data.items);
      console.log(`  Fetched ${data.items.length} plugins (total: ${allPlugins.length})`);
      
      // Stop if we have fewer results than perPage (last page)
      if (data.items.length < perPage) {
        break;
      }
      
      // Rate limit: 1 second between requests
      if (p < maxPages) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`Failed to fetch page ${p}:`, error.message);
      break;
    }
  }
  
  return allPlugins;
}

async function main() {
  console.log('Fetching DSH plugins from GitHub...\n');
  
  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Fetch plugins
  const plugins = await fetchPlugins(1, 100, 5); // Fetch up to 500 plugins
  
  if (plugins.length === 0) {
    console.error('No plugins fetched. Check your internet connection or GitHub API rate limit.');
    process.exit(1);
  }
  
  // Transform to our format
  const transformed = plugins.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    html_url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    updated_at: repo.updated_at,
    language: repo.language,
    topics: repo.topics || [],
    owner: {
      login: repo.owner?.login,
      avatar_url: repo.owner?.avatar_url,
    }
  }));
  
  // Save full data
  writeFileSync(OUTPUT_FILE, JSON.stringify(transformed, null, 2));
  console.log(`\n✅ Saved ${transformed.length} plugins to ${OUTPUT_FILE}`);
  
  // Save index (just names and basic info for quick search)
  const index = transformed.map(p => ({
    name: p.name,
    full_name: p.full_name,
    description: p.description,
    stars: p.stars,
    language: p.language,
  }));
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  console.log(`✅ Saved index to ${INDEX_FILE}`);
  
  console.log('\n🎉 Done!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
