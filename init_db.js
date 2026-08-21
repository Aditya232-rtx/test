const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'database.sqlite');

// Remove existing database if present for a fresh clean slate
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log('[*] Removed existing database.sqlite');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[-] Error opening database:', err.message);
    process.exit(1);
  }
  console.log('[+] Connected to SQLite database.');
});

db.serialize(() => {
  // 1. Create Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      address TEXT,
      api_key TEXT,
      balance REAL DEFAULT 100.00
    )
  `);

  // 2. Create Products Table (includes 'released' column for PortSwigger-style SQLi challenges)
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      rating REAL DEFAULT 5.0,
      description TEXT,
      image_url TEXT,
      released INTEGER DEFAULT 1
    )
  `);

  // 3. Create Carts Table
  db.run(`
    CREATE TABLE IF NOT EXISTS carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 4. Create Cart Items Table
  db.run(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (cart_id) REFERENCES carts(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // 5. Create Orders Table
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      shipping_address TEXT,
      status TEXT DEFAULT 'Completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // 6. Create Subscribers Table (Newsletter)
  db.run(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // --- Seed Data ---

  // Seed Users
  const insertUser = db.prepare(`
    INSERT INTO users (username, password, email, role, address, api_key, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('carlos', 'hunter2', 'carlos@ginandjuice.local', 'user', '1337 Hacker Way, Apt 404', 'carlos_api_tok_7a9f4c', 150.00);
  insertUser.run('wiener', 'peter', 'wiener@ginandjuice.local', 'user', '42 Gin Alley, London NW1', 'wiener_api_tok_9b2e11', 85.50);
  insertUser.run('administrator', 'admin_secret_987!', 'admin@ginandjuice.local', 'admin', '1 Executive Penthouse Suite, Cyber HQ', 'FLAG{G1N_JU1C3_S3CR3T_ADM1N_K3Y}', 99999.00);
  insertUser.finalize();

  // Seed Products
  const insertProduct = db.prepare(`
    INSERT INTO products (name, category, price, rating, description, image_url, released)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleProducts = [
    {
      name: 'London Dry Botanical Gin (750ml)',
      category: 'Gin',
      price: 38.50,
      rating: 4.9,
      description: 'Triple distilled small-batch artisanal gin infused with juniper berries, coriander seed, angelica root, and fresh Meyer lemon peel.',
      image_url: 'https://images.unsplash.com/photo-1527061011665-3652c757a4d4?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Artisanal Elderflower & Cucumber Gin',
      category: 'Gin',
      price: 44.00,
      rating: 4.8,
      description: 'Handcrafted floral gin distilled with wild elderflower petals and crisp English cucumbers. Refreshing and silky smooth on the palate.',
      image_url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Blood Orange Cold-Pressed Juice (1L)',
      category: 'Juice',
      price: 12.00,
      rating: 4.7,
      description: '100% pure raw Sicilian blood orange juice, cold-pressed daily with no added preservatives or refined sugars. Tart, vivid, and invigorating.',
      image_url: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Cold-Pressed Yuzu & Meyer Lemon Mixer',
      category: 'Juice',
      price: 14.50,
      rating: 4.9,
      description: 'Japanese Yuzu blended with sweet Meyer lemons and a touch of organic agave nectar. The premier mixer for craft cocktail enthusiasts.',
      image_url: 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Ruby Red Grapefruit & Rosemary Cordial',
      category: 'Juice',
      price: 11.50,
      rating: 4.6,
      description: 'Fresh Texas ruby red grapefruits simmered with aromatic organic rosemary and wildflower honey. Pairs impeccably with dry gin.',
      image_url: 'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'The Snoop Dogg Classic Gin & Juice Kit',
      category: 'Cocktail Kit',
      price: 65.00,
      rating: 5.0,
      description: 'Everything you need to make the legendary 90s West Coast cocktail: botanical gin, twin carafes of fresh citrus juices, highball glasses, and vintage recipe card.',
      image_url: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Smoky Mezcal & Botanical Gin Infusion Kit',
      category: 'Cocktail Kit',
      price: 72.00,
      rating: 4.7,
      description: 'Explore boundary-pushing hybrid mixology with wood-smoked dried fruits, botanical gin, and artisan charred oak infusion chips.',
      image_url: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Japanese Heavy-Weight Cobbler Shaker Set',
      category: 'Barware',
      price: 42.00,
      rating: 4.9,
      description: 'Precision forged 18/8 stainless steel cocktail shaker with built-in strainer, matching double jigger, and polished teardrop bar spoon.',
      image_url: 'https://images.unsplash.com/photo-1575024357670-2b5164f470c3?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: 'Laser-Etched Crystal Highball Glasses (Set of 2)',
      category: 'Barware',
      price: 29.00,
      rating: 4.8,
      description: 'Lead-free European crystal glasses featuring delicate geometric etchings for serving gin and juice cocktails over artisanal clear ice.',
      image_url: 'https://images.unsplash.com/photo-1578664182354-e38780614014?w=600&auto=format&fit=crop&q=80',
      released: 1
    },
    {
      name: '[CLASSIFIED] 1993 Limited Edition Snoopy Reserve Gin',
      category: 'Gin',
      price: 499.00,
      rating: 5.0,
      description: 'SECRET UNRELEASED ITEM! Unlocked only by SQL Injection bypass! Distilled in oak casks since 1993. Flag: FLAG{SQLI_UNRELEASED_PRODUCT_DISCOVERED}',
      image_url: 'https://images.unsplash.com/photo-1582819509237-d5b75f20ff7a?w=600&auto=format&fit=crop&q=80',
      released: 0 // Hidden / unreleased item for SQLi lab
    }
  ];

  sampleProducts.forEach(prod => {
    insertProduct.run(
      prod.name,
      prod.category,
      prod.price,
      prod.rating,
      prod.description,
      prod.image_url,
      prod.released
    );
  });
  insertProduct.finalize();

  // Seed sample carts and cart items for IDOR testing
  // Cart 1 belongs to Carlos (User ID: 1)
  // Cart 2 belongs to Wiener (User ID: 2)
  // Cart 3 belongs to Administrator (User ID: 3)
  db.run(`INSERT INTO carts (id, user_id) VALUES (1, 1), (2, 2), (3, 3)`);

  db.run(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (1, 1, 2), (1, 3, 3)`);
  db.run(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (2, 2, 1), (2, 4, 2)`);
  db.run(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (3, 6, 5), (3, 10, 1)`);

  console.log('[+] Database schema created and seeded successfully with users, products, and carts.');
});

db.close((err) => {
  if (err) {
    console.error('[-] Error closing database:', err.message);
  } else {
    console.log('[+] Database initialization complete.');
  }
});
