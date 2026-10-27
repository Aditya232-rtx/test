const express = require('express');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.sqlite');

// Check if database exists, if not inform the user
if (!fs.existsSync(DB_PATH)) {
  console.log('[!] Warning: database.sqlite not found. Please run: npm run init-db');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[-] SQLite connection error:', err.message);
  } else {
    console.log('[+] Connected to SQLite database:', DB_PATH);
  }
});

// Middleware configuration
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Template engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ==========================================
// VULNERABILITY 1: MISSING SECURITY HEADERS & CLICKJACKING
// Intentionally omitting CSP, X-Frame-Options, HSTS, etc.
// Adding a permissive CORS header for testing scanners.
// ==========================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Explicitly remove X-Frame-Options or keep it absent to allow iframe embedding
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  next();
});

// ==========================================
// Secure session handling using signed cookies (placeholder implementation)
// Note: In production, replace with robust session store and signed tokens.
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.cartCount = 0;
  
  if (req.cookies && req.cookies.session) {
    try {
      // Verify HMAC signature (simplified, assume signature verification function exists)
      const verified = true; // Placeholder: implement actual verification
      if (verified) {
        const decoded = Buffer.from(req.cookies.session, 'base64').toString('utf-8');
        const sessionUser = JSON.parse(decoded);
        res.locals.user = sessionUser;
        req.user = sessionUser;
      } else {
        res.clearCookie('session');
      }
    } catch (e) {
      // Invalid cookie format or verification failed
      res.clearCookie('session');
    }
  }
  next();
});

// Helper to determine active cart for user
function getActiveCartId(req) {
  // Enforce ownership: use the logged-in user's ID as cart ID.
  // If no authenticated user, fallback to default guest cart (ID 1).
  if (req.user && req.user.userId) {
    return req.user.userId;
  }
  return 1; // Guest cart
}

// ------------------------------------------
// 1. PRODUCT CATALOG & SQL INJECTION (SQLi)
// ------------------------------------------

// Homepage / Catalog with Category Filter (VULNERABLE to SQL Injection)
app.get('/', (req, res) => {
  const category = req.query.category;
  const sortBy = req.query.sort || 'name';

  let sql = 'SELECT * FROM products WHERE released = 1';

  if (category) {
    // VULNERABILITY: Direct string concatenation allows classic SQLi
    // Exploit: /?category=Gin'+OR+1=1--
    // Exploit: /?category=Gin'+UNION+SELECT+id,username,password,email,role,api_key,balance,1+FROM+users--
    sql = `SELECT * FROM products WHERE category = '${category}' AND released = 1`;
  }

  db.all(sql, [], (err, products) => {
    if (err) {
      // Intentionally exposing database error details (Information Disclosure)
      return res.status(500).render('index', {
        products: [],
        categories: ['Gin', 'Juice', 'Cocktail Kit', 'Barware'],
        selectedCategory: category || '',
        searchQuery: '',
        dbError: err.message,
        executedSql: sql
      });
    }

    res.render('index', {
      products: products || [],
      categories: ['Gin', 'Juice', 'Cocktail Kit', 'Barware'],
      selectedCategory: category || '',
      searchQuery: '',
      dbError: null,
      executedSql: sql
    });
  });
});

// Product Search endpoint (VULNERABLE to SQL Injection)
app.get('/search', (req, res) => {
  const q = req.query.q || '';

  // VULNERABILITY: Raw SQL concatenation in LIKE clause
  // Exploit: /search?q=test%' UNION SELECT id, username, password, email, role, address, balance, 1 FROM users --
  const sql = `SELECT * FROM products WHERE (name LIKE '%${q}%' OR description LIKE '%${q}%') AND released = 1`;

  db.all(sql, [], (err, products) => {
    if (err) {
      return res.status(500).render('index', {
        products: [],
        categories: ['Gin', 'Juice', 'Cocktail Kit', 'Barware'],
        selectedCategory: '',
        searchQuery: q,
        dbError: err.message,
        executedSql: sql
      });
    }

    res.render('index', {
      products: products || [],
      categories: ['Gin', 'Juice', 'Cocktail Kit', 'Barware'],
      selectedCategory: '',
      searchQuery: q,
      dbError: null,
      executedSql: sql
    });
  });
});

// Product Details Page (Contains DOM XSS vector)
app.get('/product', (req, res) => {
  const productId = req.query.id || 1;
  const sql = `SELECT * FROM products WHERE id = ?`;

  db.get(sql, [productId], (err, product) => {
    if (err || !product) {
      return res.status(404).send('Product not found.');
    }
    res.render('product', {
      product: product,
      customMsg: req.query.custom_msg || '',
      discountCode: req.query.promo || ''
    });
  });
});

// ------------------------------------------
// 2. AUTHENTICATION & LOGIN BYPASS (SQLi & Broken Auth)
// ------------------------------------------

app.get('/login', (req, res) => {
  if (req.user) {
    return res.redirect('/profile');
  }
  res.render('login', { error: null, query: req.query });
});

// Vulnerable Login Route (SQL Injection Authentication Bypass)
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // VULNERABILITY: SQL Injection in Authentication
  // Exploit username: administrator'--  or  carlos' OR 1=1--
  const sql = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;

  db.get(sql, [], (err, user) => {
    if (err) {
      return res.status(500).render('login', {
        error: `Database Error: ${err.message} (Executed: ${sql})`,
        query: {}
      });
    }

    if (!user) {
      return res.status(401).render('login', {
        error: 'Invalid username or password.',
        query: {}
      });
    }

    // Set Insecure Base64 Encoded JSON Session Cookie
    const sessionData = {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isAdmin: user.role === 'admin'
    };

    const sessionCookie = Buffer.from(JSON.stringify(sessionData)).toString('base64');
    
    // Cookie flags omitted: no httpOnly (accessible to XSS), no secure, no sameSite
    res.cookie('session', sessionCookie, { maxAge: 86400000 });
    
    if (user.role === 'admin') {
      return res.redirect('/admin');
    }
    res.redirect('/profile');
  });
});

app.get('/logout', (req, res) => {
  res.clearCookie('session');
  res.redirect('/');
});

// ------------------------------------------
// 3. INSECURE DIRECT OBJECT REFERENCE (IDOR) & CSRF
// ------------------------------------------

// User Profile (VULNERABLE to IDOR via ?id= query param)
app.get('/profile', (req, res) => {
  // Enforce ownership: users can only view their own profile unless they are admin
  const requester = req.user;
  let targetUserId;
  if (req.query.id) {
    // If an explicit id is requested, ensure it matches the logged-in user or the user is admin
    if (requester && (requester.userId === parseInt(req.query.id, 10) || requester.role === 'admin')) {
      targetUserId = parseInt(req.query.id, 10);
    } else {
      // Unauthorized attempt, default to own profile
      targetUserId = requester ? requester.userId : 1;
    }
  } else {
    // No id param, default to own profile
    targetUserId = requester ? requester.userId : 1;
  }

  const sql = `SELECT id, username, email, role, address, api_key, balance FROM users WHERE id = ?`;
  db.get(sql, [targetUserId], (err, targetUser) => {
    if (err || !targetUser) {
      return res.status(404).send('User profile not found.');
    }
    res.render('profile', {
      profileUser: targetUser,
      isOwnProfile: requester && requester.userId === targetUser.id,
      message: req.query.msg || null
    });
  });
});

// Vulnerable Email Change Endpoint (Missing Anti-CSRF Token)
app.post('/profile/change-email', (req, res) => {
  const newEmail = req.body.email;
  const userId = req.body.userId || (req.user ? req.user.userId : 1);

  if (!newEmail) {
    return res.redirect('/profile?msg=Email+cannot+be+empty');
  }

  // Ensure the requester is either the user themselves or an admin
  const requester = req.user;
  if (!requester || (requester.userId !== userId && requester.role !== 'admin')) {
    // Unauthorized attempt
    return res.status(403).send('Forbidden: cannot change another user\'s email');
  }

  const sql = `UPDATE users SET email = ? WHERE id = ?`;
  db.run(sql, [newEmail, userId], function(err) {
    if (err) {
      return res.status(500).send('Error updating email: ' + err.message);
    }
    res.redirect(`/profile?id=${userId}&msg=Email+successfully+updated+to+${encodeURIComponent(newEmail)}`);
  });
});

// ------------------------------------------
// 4. SHOPPING CART (IDOR & TAMPERING)
// ------------------------------------------

// View Cart (VULNERABLE to IDOR: view any cart by changing ?cartId=)
app.get('/cart', (req, res) => {
  const cartId = getActiveCartId(req);

  const sql = `
    SELECT 
      ci.id AS item_id,
      ci.cart_id,
      ci.product_id,
      ci.quantity,
      p.name,
      p.price,
      p.image_url,
      (ci.quantity * p.price) AS subtotal
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.cart_id = ?
  `;

  db.all(sql, [cartId], (err, items) => {
    if (err) {
      return res.status(500).send('Error fetching cart: ' + err.message);
    }

    const total = (items || []).reduce((acc, item) => acc + item.subtotal, 0);

    res.render('cart', {
      cartId: cartId,
      items: items || [],
      total: total.toFixed(2),
      orderSuccess: req.query.ordered || null
    });
  });
});

// Add Item to Cart (VULNERABLE: accepts arbitrary cartId)
app.post('/cart/add', (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  const quantity = parseInt(req.body.quantity, 10) || 1;
  const cartId = parseInt(req.body.cartId, 10) || getActiveCartId(req);

  // Check if item already in cart
  db.get(`SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?`, [cartId, productId], (err, row) => {
    if (row) {
      db.run(`UPDATE cart_items SET quantity = quantity + ? WHERE id = ?`, [quantity, row.id], () => {
        res.redirect(`/cart?cartId=${cartId}`);
      });
    } else {
      db.run(`INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)`, [cartId, productId, quantity], () => {
        res.redirect(`/cart?cartId=${cartId}`);
      });
    }
  });
});

// Remove Item from Cart (VULNERABLE: removes item by itemId without checking cart ownership)
app.post('/cart/remove', (req, res) => {
  const itemId = req.body.itemId;
  const cartId = req.body.cartId || getActiveCartId(req);

  db.run(`DELETE FROM cart_items WHERE id = ?`, [itemId], () => {
    res.redirect(`/cart?cartId=${cartId}`);
  });
});

// Checkout Cart
app.post('/cart/checkout', (req, res) => {
  const cartId = req.body.cartId || getActiveCartId(req);
  const userId = req.user ? req.user.userId : cartId;

  // Clear cart items
  db.run(`DELETE FROM cart_items WHERE cart_id = ?`, [cartId], (err) => {
    res.redirect(`/cart?cartId=${cartId}&ordered=true`);
  });
});

// ------------------------------------------
// 5. NEWSLETTER SUBSCRIPTION (REFLECTED XSS)
// ------------------------------------------

// Reflected XSS Endpoint
// Accepts email query or body and renders directly into unescaped template
app.all('/subscribe', (req, res) => {
  const email = req.query.email || req.body.email || '';
  
  if (!email) {
    return res.render('subscribe', {
      email: '',
      message: 'Please enter a valid email address to subscribe.'
    });
  }

  // Insert to DB (stored for auditing)
  db.run(`INSERT INTO subscribers (email) VALUES (?)`, [email]);

  // VULNERABILITY: Reflected XSS directly outputting user input in template with <%- email %>
  // Exploit: /subscribe?email=<script>alert('Reflected-XSS-Pwned!')</script>
  res.render('subscribe', {
    email: email,
    message: `Thank you for subscribing! A welcome discount has been dispatched to: `
  });
});

// ------------------------------------------
// 6. ADMIN PANEL (PRIVILEGE ESCALATION VIA SESSION FORGERY)
// ------------------------------------------

app.get('/admin', (req, res) => {
  // Check if session has admin role or isAdmin: true
  if (!req.user || (!req.user.isAdmin && req.user.role !== 'admin')) {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head><title>403 Forbidden</title><link rel="stylesheet" href="/css/style.css"></head>
      <body style="padding: 40px; text-align: center;">
        <div class="glass-card" style="max-width: 600px; margin: 50px auto; padding: 30px;">
          <h1 style="color: #ef4444;">403 Access Denied</h1>
          <p>Administrative privileges are required to access this endpoint.</p>
          <p style="font-size: 0.85rem; color: #94a3b8;">Current Session: <code>${req.cookies.session ? Buffer.from(req.cookies.session, 'base64').toString('utf-8') : 'None'}</code></p>
          <a href="/login" class="btn btn-primary" style="margin-top: 15px; display: inline-block;">Log in as Administrator</a>
        </div>
      </body>
      </html>
    `);
  }

  // Admin view - list all users and orders
  db.all(`SELECT id, username, email, role, balance, api_key FROM users`, [], (err, users) => {
    db.all(`SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 10`, [], (err2, subs) => {
      res.render('admin', {
        adminUser: req.user,
        users: users || [],
        subscribers: subs || [],
        secretFlag: 'FLAG{G1N_JU1C3_S3CR3T_ADM1N_K3Y}'
      });
    });
  });
});

// Admin Delete User Endpoint (Missing CSRF protection)
app.post('/admin/delete-user', (req, res) => {
  if (!req.user || (!req.user.isAdmin && req.user.role !== 'admin')) {
    return res.status(403).send('Forbidden');
  }

  const deleteId = req.body.id;
  db.run(`DELETE FROM users WHERE id = ? AND role != 'admin'`, [deleteId], () => {
    res.redirect('/admin');
  });
});

// ------------------------------------------
// 7. VULNERABILITIES SCOREBOARD & SCANNER BENCHMARK INDEX
// ------------------------------------------

app.get('/vulnerabilities', (req, res) => {
  const vulnerabilitiesList = [
    {
      id: 'VULN-01',
      name: 'SQL Injection - Product Category Filter',
      category: 'SQL Injection',
      severity: 'CRITICAL',
      cwe: 'CWE-89',
      owasp: 'A03:2021-Injection',
      endpoint: 'GET /?category=',
      description: 'The category parameter in the catalog filter is concatenated directly into the SQL query without parameterization or escaping.',
      payloadExample: "/?category=Gin' UNION SELECT id, username, password, email, role, api_key, balance, 1 FROM users--",
      impact: 'Allows dumping the entire users database, password hashes, and discovering unreleased secret products.',
      remediation: 'Use parameterized queries / prepared statements (e.g. db.all("SELECT * FROM products WHERE category = ?", [category])).'
    },
    {
      id: 'VULN-02',
      name: 'SQL Injection - Authentication Bypass',
      category: 'SQL Injection',
      severity: 'CRITICAL',
      cwe: 'CWE-89',
      owasp: 'A03:2021-Injection',
      endpoint: 'POST /login',
      description: 'The username and password fields are inserted directly into the authentication query string.',
      payloadExample: "Username: administrator'--\nPassword: (any text)",
      impact: 'Allows unauthorized login as administrator or any registered user without knowing their password.',
      remediation: 'Use parameterized SQL queries and verify passwords with robust hashing algorithms like Argon2 or bcrypt.'
    },
    {
      id: 'VULN-03',
      name: 'Reflected Cross-Site Scripting (XSS)',
      category: 'Cross-Site Scripting',
      severity: 'HIGH',
      cwe: 'CWE-79',
      owasp: 'A03:2021-Injection',
      endpoint: 'GET/POST /subscribe',
      description: 'The email parameter submitted to the newsletter form is rendered directly back into the response template without HTML escaping.',
      payloadExample: "/subscribe?email=%3Cscript%3Ealert('Reflected+XSS')%3C/script%3E",
      impact: 'Enables execution of malicious client-side JavaScript, session cookie theft, and page defacement.',
      remediation: 'Sanitize and HTML-entity encode all untrusted user inputs before rendering into the DOM or templates.'
    },
    {
      id: 'VULN-04',
      name: 'DOM-based Cross-Site Scripting (DOM XSS)',
      category: 'Cross-Site Scripting',
      severity: 'HIGH',
      cwe: 'CWE-79',
      owasp: 'A03:2021-Injection',
      endpoint: 'GET /product?id=1&custom_msg=',
      description: 'The product details page reads the custom_msg query parameter or hash and sinks it directly into an element via unsafe innerHTML.',
      payloadExample: '/product?id=1&custom_msg=<img src=x onerror=alert("DOM-XSS")>',
      impact: 'Executes arbitrary script in the context of the user browsing the product catalog.',
      remediation: 'Use textContent or secure DOM manipulation APIs instead of innerHTML.'
    },
    {
      id: 'VULN-05',
      name: 'Insecure Direct Object Reference (IDOR) - Cart & Profile',
      category: 'Broken Access Control',
      severity: 'HIGH',
      cwe: 'CWE-639',
      owasp: 'A01:2021-Broken Access Control',
      endpoint: 'GET /cart?cartId=X and GET /profile?id=X',
      description: 'Object references (cart ID and user ID) are exposed directly in URL parameters without validating if the current session owns the resource.',
      payloadExample: '/cart?cartId=3 (Admin Cart) or /profile?id=3 (Admin API Key & Address)',
      impact: 'Unauthorized reading and modification of other users private shopping carts, emails, addresses, and API keys.',
      remediation: 'Enforce server-side authorization checks comparing req.user.userId against the requested resource ownership.'
    },
    {
      id: 'VULN-06',
      name: 'Broken Authentication - Insecure Cookie Session Forgery',
      category: 'Identification and Authentication Failures',
      severity: 'HIGH',
      cwe: 'CWE-384',
      owasp: 'A07:2021-Identification & Auth Failures',
      endpoint: 'Cookie: session=',
      description: 'The session cookie is an unencrypted, unsigned Base64 string containing JSON user details ({userId, username, role, isAdmin}).',
      payloadExample: 'Set Cookie session = eyJ1c2VySWQiOjMsInVzZXJuYW1lIjoiYWRtaW5pc3RyYXRvciIsInJvbGUiOiJhZG1pbiIsImlzQWRtaW4iOnRydWV9',
      impact: 'Attackers can forge arbitrary identity attributes to elevate privileges to administrator instantly.',
      remediation: 'Use cryptographically secure, signed session tokens (HMAC-SHA256) or server-managed opaque session identifiers.'
    },
    {
      id: 'VULN-07',
      name: 'Cross-Site Request Forgery (CSRF)',
      category: 'Broken Access Control',
      severity: 'MEDIUM',
      cwe: 'CWE-352',
      owasp: 'A01:2021-Broken Access Control',
      endpoint: 'POST /profile/change-email and POST /admin/delete-user',
      description: 'State-changing actions lack Anti-CSRF synchronization tokens and SameSite cookie restrictions.',
      payloadExample: '<form action="http://localhost:3000/profile/change-email" method="POST"><input type="hidden" name="email" value="attacker@evil.com"><input type="hidden" name="userId" value="1"></form><script>document.forms[0].submit()</script>',
      impact: 'Enables third-party sites to force logged-in users to modify sensitive account details without their consent.',
      remediation: 'Implement anti-CSRF tokens and set SameSite=Strict or SameSite=Lax on authentication cookies.'
    },
    {
      id: 'VULN-08',
      name: 'Missing Security Headers & Clickjacking',
      category: 'Security Misconfiguration',
      severity: 'LOW/MEDIUM',
      cwe: 'CWE-1021',
      owasp: 'A05:2021-Security Misconfiguration',
      endpoint: 'All Endpoints',
      description: 'Headers like Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, and Strict-Transport-Security are absent.',
      payloadExample: 'Visit /clickjack-test to see the site framed in an invisible transparent iframe overlay.',
      impact: 'Enables UI redressing/clickjacking attacks and makes exploitation of XSS much simpler.',
      remediation: 'Configure Helmet middleware or explicit headers for CSP and X-Frame-Options: DENY.'
    },
    {
      id: 'VULN-09',
      name: 'Information Disclosure - System Debug & Backup Endpoint',
      category: 'Security Misconfiguration',
      severity: 'LOW',
      cwe: 'CWE-200',
      owasp: 'A05:2021-Security Misconfiguration',
      endpoint: 'GET /api/debug/system-info and GET /backup.db',
      description: 'Sensitive server environment parameters and the entire raw SQLite database file are publicly accessible.',
      payloadExample: 'GET /api/debug/system-info or GET /backup.db',
      impact: 'Exposes environment metadata and full local database file to unauthorized attackers.',
      remediation: 'Disable debug endpoints in production and restrict static directory file mappings.'
    }
  ];

  res.render('vulnerabilities', {
    vulnerabilities: vulnerabilitiesList
  });
});

// ------------------------------------------
// 8. ADDITIONAL TESTING & DEBUG ENDPOINTS
// ------------------------------------------

// Clickjacking Demonstration Page
app.get('/clickjack-test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Clickjacking PoC Demonstration</title>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; text-align: center; padding: 20px; }
        .wrapper { position: relative; width: 900px; height: 600px; margin: 0 auto; border: 2px dashed #ef4444; }
        iframe { width: 100%; height: 100%; border: none; opacity: 0.8; }
        .decoy-btn { position: absolute; top: 180px; left: 350px; padding: 15px 30px; background: #10b981; color: #fff; font-size: 18px; border: none; border-radius: 8px; cursor: pointer; pointer-events: none; z-index: -1; }
      </style>
    </head>
    <body>
      <h2>Clickjacking / UI Redressing PoC (CWE-1021)</h2>
      <p>Because <code>X-Frame-Options</code> and <code>CSP frame-ancestors</code> are missing, this page can be framed:</p>
      <div class="wrapper">
        <iframe src="/"></iframe>
      </div>
      <p style="margin-top: 15px;"><a href="/" style="color: #38bdf8;">Return to Gin & Juice Shop</a></p>
    </body>
    </html>
  `);
});

// Exposed Robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nDisallow: /admin\nDisallow: /vulnerabilities\nDisallow: /backup.db\nDisallow: /api/debug\n`);
});

// Information Disclosure Endpoint
app.get('/api/debug/system-info', (req, res) => {
  res.json({
    status: 'online',
    app: 'Gin & Juice Shop - Vulnerable Pentest Target',
    environment: 'development-debug',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      type: 'SQLite3',
      file: DB_PATH,
      writable: true
    },
    flags: {
      sqliFlag: 'FLAG{SQLI_UNRELEASED_PRODUCT_DISCOVERED}',
      adminFlag: 'FLAG{G1N_JU1C3_S3CR3T_ADM1N_K3Y}'
    }
  });
});

// Exposed Database Download Endpoint
app.get('/backup.db', (req, res) => {
  if (fs.existsSync(DB_PATH)) {
    res.download(DB_PATH, 'gin_and_juice_backup.sqlite');
  } else {
    res.status(404).send('Database file not found.');
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head><title>404 Not Found</title><link rel="stylesheet" href="/css/style.css"></head>
    <body style="text-align: center; padding: 60px;">
      <div class="glass-card" style="max-width: 500px; margin: auto; padding: 30px;">
        <h1 style="color: #ef4444;">404</h1>
        <p>The requested route was not found on this craft distillery server.</p>
        <a href="/" class="btn btn-primary" style="margin-top: 15px; display: inline-block;">Return Home</a>
      </div>
    </body>
    </html>
  `);
});

// Start Server
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🍸 GIN & JUICE SHOP - DELIBERATELY VULNERABLE LAB`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`🎯 Vulnerabilities Scoreboard: http://localhost:${PORT}/vulnerabilities`);
  console.log(`👤 Default user: carlos / hunter2`);
  console.log(`👑 Admin user: administrator / admin_secret_987!`);
  console.log('====================================================');
});
