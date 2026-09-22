import sqlite3
import os
import json
from datetime import datetime, timedelta, timezone

# Zona horaria oficial de Argentina (UTC-3)
AR_TZ = timezone(timedelta(hours=-3))

def get_now_ar():
    """Retorna la fecha y hora actual en zona horaria de Argentina (UTC-3)"""
    return datetime.now(AR_TZ)

DB_PATH = os.path.join(os.path.dirname(__file__), "catalogo.db")

PAYMENT_SURCHARGES = {
    'Efectivo': 0.0,
    'Transferencia alias mercadopago / alias bancaria': 0.0,
    'QR mercadopago': 1.0,
    'Tarjeta de Débito': 2.0,
    'Tarjeta de Crédito': 7.0
}

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Tabla de categorías
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        order_index INTEGER DEFAULT 0,
        icon TEXT DEFAULT ''
    );
    """)

    # Tabla de productos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        presentation TEXT DEFAULT '',
        price_minorista REAL NOT NULL DEFAULT 0.0,
        price_mayorista REAL NOT NULL DEFAULT 0.0,
        wholesale_tier1_price REAL DEFAULT 0.0,
        wholesale_tier2_price REAL DEFAULT 0.0,
        image_path TEXT DEFAULT '',
        order_index INTEGER DEFAULT 0,
        stock INTEGER DEFAULT 10,
        is_active INTEGER DEFAULT 1,
        is_featured INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
    );
    """)

    # Migración automática de columnas en products
    cursor.execute("PRAGMA table_info(products)")
    columns = [col[1] for col in cursor.fetchall()]
    if "stock" not in columns:
        cursor.execute("ALTER TABLE products ADD COLUMN stock INTEGER DEFAULT 10")
    if "cost_price" not in columns:
        cursor.execute("ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0.0")
    if "supplier" not in columns:
        cursor.execute("ALTER TABLE products ADD COLUMN supplier TEXT DEFAULT ''")
    if "profit_margin_target" not in columns:
        cursor.execute("ALTER TABLE products ADD COLUMN profit_margin_target REAL DEFAULT 0.0")

    # Tabla de configuración del negocio y catálogo
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    """)

    # Tabla de Ventas (Punto de Venta)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_name TEXT NOT NULL,
        price_type TEXT DEFAULT 'minorista',
        payment_method TEXT DEFAULT 'Efectivo',
        notes TEXT DEFAULT '',
        subtotal_amount REAL NOT NULL DEFAULT 0.0,
        surcharge_pct REAL NOT NULL DEFAULT 0.0,
        surcharge_amount REAL NOT NULL DEFAULT 0.0,
        total_amount REAL NOT NULL DEFAULT 0.0,
        total_cost REAL NOT NULL DEFAULT 0.0,
        total_profit REAL NOT NULL DEFAULT 0.0,
        total_items INTEGER NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'completed', -- 'completed', 'cancelled'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Migración de columnas en sales
    cursor.execute("PRAGMA table_info(sales)")
    sales_cols = [col[1] for col in cursor.fetchall()]
    if "subtotal_amount" not in sales_cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN subtotal_amount REAL DEFAULT 0.0")
    if "surcharge_pct" not in sales_cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN surcharge_pct REAL DEFAULT 0.0")
    if "surcharge_amount" not in sales_cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN surcharge_amount REAL DEFAULT 0.0")
    if "total_cost" not in sales_cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN total_cost REAL DEFAULT 0.0")
    if "total_profit" not in sales_cols:
        cursor.execute("ALTER TABLE sales ADD COLUMN total_profit REAL DEFAULT 0.0")

    # Actualizar nombres antiguos de medios de pago si existen
    cursor.execute("""
    UPDATE sales 
    SET payment_method = 'Transferencia alias mercadopago / alias bancaria' 
    WHERE payment_method = 'Transferencia / MP' OR payment_method = 'Transferencia'
    """)
    cursor.execute("""
    UPDATE sales 
    SET payment_method = 'QR mercadopago' 
    WHERE payment_method = 'Cuenta Corriente'
    """)

    # Tabla de Ítems de Venta
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        presentation TEXT DEFAULT '',
        price_type TEXT NOT NULL,
        unit_price REAL NOT NULL,
        cost_price REAL NOT NULL DEFAULT 0.0,
        profit REAL NOT NULL DEFAULT 0.0,
        quantity INTEGER NOT NULL DEFAULT 1,
        subtotal REAL NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products (id)
    );
    """)

    # Migración de columnas en sale_items
    cursor.execute("PRAGMA table_info(sale_items)")
    si_cols = [col[1] for col in cursor.fetchall()]
    if "cost_price" not in si_cols:
        cursor.execute("ALTER TABLE sale_items ADD COLUMN cost_price REAL DEFAULT 0.0")
    if "profit" not in si_cols:
        cursor.execute("ALTER TABLE sale_items ADD COLUMN profit REAL DEFAULT 0.0")

    # Backfill para calcular costos y utilidades en ítems históricos
    cursor.execute("""
    UPDATE sale_items
    SET cost_price = COALESCE(
        (SELECT NULLIF(p.cost_price, 0) FROM products p WHERE p.id = sale_items.product_id),
        ROUND(sale_items.unit_price * 0.75, 2)
    )
    WHERE cost_price IS NULL OR cost_price = 0.0
    """)

    cursor.execute("""
    UPDATE sale_items
    SET profit = ROUND((unit_price - cost_price) * quantity, 2)
    WHERE profit IS NULL OR profit = 0.0
    """)

    # Backfill para total_cost y total_profit en sales
    cursor.execute("""
    UPDATE sales
    SET total_cost = (
        SELECT COALESCE(SUM(si.cost_price * si.quantity), 0.0)
        FROM sale_items si
        WHERE si.sale_id = sales.id
    )
    WHERE total_cost IS NULL OR total_cost = 0.0
    """)

    cursor.execute("""
    UPDATE sales
    SET total_profit = ROUND(total_amount - total_cost, 2)
    WHERE total_profit IS NULL OR total_profit = 0.0
    """)

    # Configuración predeterminada basada en el diseño "BEBIDAS 25 DE MAYO"
    default_settings = {
        "business_name": "BEBIDAS 25 DE MAYO",
        "header_subtitle_minorista": "Catálogo de Productos · Minorista",
        "header_subtitle_mayorista": "Catálogo de Precios · Mayorista",
        "banner_phrase": "PARA TU NEGOCIO Y PARA VOS",
        "disclaimer": "Precios sujetos a modificación sin previo aviso. Las imágenes son de carácter ilustrativo. Consulte disponibilidad y condiciones comerciales.",
        "footer_text": "BEBIDAS 25 DE MAYO — MINORISTA Y MAYORISTA",
        "whatsapp_text": "Pedidos y consultas por WhatsApp",
        "whatsapp_number": "+54 9 11 2525-2525",
        "instagram": "@bebidas25demayo",
        "address": "Av. 25 de Mayo 1234, Buenos Aires",
        "cover_business_hours": "Lunes a Sábados de 10:00 a 22:00 hs",
        "cover_delivery_info": "Envíos a domicilio y entregas en el día · Consultar zonas de entrega",
        "logo_path": "uploads/logo.jpg",
        "primary_color": "#B81414",          # Rojo institucional 25 de Mayo
        "category_header_color": "#F5C518",  # Dorado / Amarillo categorías
        "category_header_text": "#111111",   # Texto encabezado de categoría
        "price_color": "#B81414",            # Rojo precio
        "catalog_bg_color": "#000000",       # Negro puro
        "currency_symbol": "$",
        "pdf_style_minorista": "cards",      # 'cards' para 12 productos por página con fotos
        "pdf_style_mayorista": "list"        # 'list' para lista de precios oficial
    }

    for key, val in default_settings.items():
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, str(val)))

    # Tabla de Combos de Bebidas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS combos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        badge TEXT DEFAULT '',
        price REAL NOT NULL,
        regular_price REAL DEFAULT 0.0,
        image_path TEXT DEFAULT '',
        items_json TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        order_index INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Seed inicial de combos si la tabla está vacía
    cursor.execute("SELECT COUNT(*) FROM combos")
    if cursor.fetchone()[0] == 0:
        default_combos = [
            (
                "Combo Fernet Branca + 2 Coca-Cola 2.25L",
                "1 Fernet Branca 750ml + 2 Coca-Cola 2.25L descartables",
                "🔥 PROMO BOMBA",
                26000.0,
                29500.0,
                "uploads/combos/combo_fernet_coca.png",
                json.dumps([{"name": "Fernet Branca 750ml", "qty": 1}, {"name": "Coca-Cola 2.25L", "qty": 2}]),
                1,
                1
            ),
            (
                "Combo Vodka Absolut + 3 Speed XL",
                "1 Vodka Absolut Regular 700ml + 3 Speed Unlimited XL 500ml",
                "💥 MÁS ELEGIDO",
                31000.0,
                35000.0,
                "uploads/combos/combo_absolut_speed.png",
                json.dumps([{"name": "Vodka Absolut 700ml", "qty": 1}, {"name": "Speed XL 500ml", "qty": 3}]),
                1,
                2
            ),
            (
                "Combo JW Red Label + 3 Speed XL",
                "1 Whisky Johnnie Walker Red Label 1L + 3 Speed Unlimited XL 500ml",
                "⚡ COMBO FIESTA",
                37000.0,
                41500.0,
                "uploads/combos/combo_jw_speed.png",
                json.dumps([{"name": "Whisky JW Red Label 1L", "qty": 1}, {"name": "Speed XL 500ml", "qty": 3}]),
                1,
                3
            ),
            (
                "Combo Vodka Skyy + 2 Speed XL",
                "1 Vodka Skyy 700ml + 2 Speed Unlimited XL 500ml",
                "🍹 PREVIA CLÁSICA",
                17500.0,
                19800.0,
                "uploads/combos/combo_skyy_speed.png",
                json.dumps([{"name": "Vodka Skyy 700ml", "qty": 1}, {"name": "Speed XL 500ml", "qty": 2}]),
                1,
                4
            ),
            (
                "Combo Pack Corona x6 Botellas 710ml",
                "6 Botellas Cerveza Corona 710ml retornable / descartable",
                "🍺 PACK FIESTA",
                31000.0,
                34000.0,
                "uploads/combos/corona_710.png",
                json.dumps([{"name": "Cerveza Corona Botella 710ml", "qty": 6}]),
                1,
                5
            ),
            (
                "Combo Pack Heineken x6 Latones 710ml",
                "6 Latones Cerveza Heineken 710ml",
                "⭐ PREMIUM BEER",
                26500.0,
                29000.0,
                "uploads/combos/heineken_710.png",
                json.dumps([{"name": "Cerveza Heineken Latón 710ml", "qty": 6}]),
                1,
                6
            )
        ]
        cursor.executemany("""
            INSERT INTO combos (name, description, badge, price, regular_price, image_path, items_json, is_active, order_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, default_combos)

    conn.commit()
    conn.close()

def get_all_settings():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    return {row["key"]: row["value"] for row in rows}

def update_settings(settings_dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    for key, value in settings_dict.items():
        cursor.execute("""
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """, (key, str(value)))
    conn.commit()
    conn.close()

def get_categories():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.*, COUNT(p.id) as product_count 
        FROM categories c 
        LEFT JOIN products p ON c.id = p.category_id 
        GROUP BY c.id 
        ORDER BY c.order_index ASC, c.name ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_products(category_id=None, query=None, active_only=False):
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT p.*, c.name as category_name 
        FROM products p 
        JOIN categories c ON p.category_id = c.id 
        WHERE 1=1
    """
    params = []
    if category_id:
        sql += " AND p.category_id = ?"
        params.append(category_id)
    if query:
        sql += " AND (p.name LIKE ? OR p.presentation LIKE ? OR c.name LIKE ?)"
        term = f"%{query}%"
        params.extend([term, term, term])
    if active_only:
        sql += " AND p.is_active = 1"

    sql += " ORDER BY c.order_index ASC, c.name ASC, p.order_index ASC, p.name ASC"
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_public_products(category_id=None, query=None):
    """
    Retorna productos activos sanitizados para clientes finales.
    EXCLUYE estrictamente: cost_price, supplier, profit_margin_target.
    Ofusca stock exacto: solo marca is_low_stock (1 a 3 un.) y is_out_of_stock.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    sql = """
        SELECT 
            p.id,
            p.category_id,
            c.name as category_name,
            p.name,
            p.presentation,
            p.price_minorista,
            p.price_mayorista,
            p.image_path,
            p.is_featured,
            p.stock
        FROM products p 
        JOIN categories c ON p.category_id = c.id 
        WHERE p.is_active = 1
    """
    params = []
    if category_id:
        sql += " AND p.category_id = ?"
        params.append(category_id)
    if query:
        sql += " AND (p.name LIKE ? OR p.presentation LIKE ? OR c.name LIKE ?)"
        term = f"%{query}%"
        params.extend([term, term, term])

    sql += " ORDER BY p.is_featured DESC, c.order_index ASC, c.name ASC, p.order_index ASC, p.name ASC"
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()

    public_products = []
    for r in rows:
        stock = int(r["stock"] if r["stock"] is not None else 0)
        is_out = stock <= 0
        is_low = 1 <= stock <= 3
        
        public_products.append({
            "id": r["id"],
            "category_id": r["category_id"],
            "category_name": r["category_name"],
            "name": r["name"],
            "presentation": r["presentation"],
            "price_minorista": float(r["price_minorista"] or 0.0),
            "price_mayorista": float(r["price_mayorista"] or 0.0),
            "image_path": r["image_path"],
            "is_featured": int(r["is_featured"] or 0),
            "is_out_of_stock": is_out,
            "is_low_stock": is_low,
            "low_stock_count": stock if is_low else None
            # Confidencialidad: NUNCA incluir cost_price, supplier ni márgenes
        })
    return public_products

def get_public_categories():
    """
    Retorna categorías que tienen productos activos para mostrar en la tienda de clientes.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.id, c.name, c.order_index, c.icon, COUNT(p.id) as product_count
        FROM categories c
        JOIN products p ON c.id = p.category_id AND p.is_active = 1
        GROUP BY c.id
        HAVING COUNT(p.id) > 0
        ORDER BY c.order_index ASC, c.name ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_public_combos():
    """
    Retorna combos activos para la tienda de clientes con sus detalles e ítems incluidos.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, description, badge, price, regular_price, image_path, items_json, order_index
        FROM combos
        WHERE is_active = 1
        ORDER BY order_index ASC, id ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    combos = []
    for r in rows:
        c = dict(r)
        try:
            c['items'] = json.loads(c.get('items_json') or '[]')
        except Exception:
            c['items'] = []
        combos.append(c)
    return combos

def get_combos():
    """Retorna todos los combos (para administración)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM combos ORDER BY order_index ASC, id ASC")
    rows = cursor.fetchall()
    conn.close()
    combos = []
    for r in rows:
        c = dict(r)
        try:
            c['items'] = json.loads(c.get('items_json') or '[]')
        except Exception:
            c['items'] = []
        combos.append(c)
    return combos

def create_combo(data):
    conn = get_db_connection()
    cursor = conn.cursor()
    items_json = data.get("items_json")
    if isinstance(items_json, (list, dict)):
        items_json = json.dumps(items_json)
    elif not items_json:
        items_json = "[]"

    cursor.execute("""
        INSERT INTO combos (name, description, badge, price, regular_price, image_path, items_json, is_active, order_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("name"),
        data.get("description", ""),
        data.get("badge", ""),
        float(data.get("price", 0) or 0),
        float(data.get("regular_price", 0) or 0),
        data.get("image_path", ""),
        items_json,
        1 if data.get("is_active", 1) in [1, True, "1", "true"] else 0,
        int(data.get("order_index", 0) or 0)
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def update_combo(combo_id, data):
    conn = get_db_connection()
    cursor = conn.cursor()
    items_json = data.get("items_json")
    if isinstance(items_json, (list, dict)):
        items_json = json.dumps(items_json)
        
    fields = []
    values = []
    for key in ["name", "description", "badge", "price", "regular_price", "image_path", "is_active", "order_index"]:
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if items_json is not None:
        fields.append("items_json = ?")
        values.append(items_json)
        
    if fields:
        values.append(combo_id)
        cursor.execute(f"UPDATE combos SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    conn.close()

def delete_combo(combo_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM combos WHERE id = ?", (combo_id,))
    conn.commit()
    conn.close()



def get_product(product_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT p.*, c.name as category_name 
        FROM products p 
        JOIN categories c ON p.category_id = c.id 
        WHERE p.id = ?
    """, (product_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def create_product(data):
    conn = get_db_connection()
    cursor = conn.cursor()
    p_min = float(data.get("price_minorista", 0) or 0)
    cost_val = float(data.get("cost_price", 0) or 0)
    margin_val = float(data.get("profit_margin_target", 0) or 0)
    if margin_val == 0 and cost_val > 0 and p_min > 0:
        margin_val = round(((p_min - cost_val) / p_min) * 100, 1)

    cursor.execute("""
        INSERT INTO products (
            category_id, name, presentation, price_minorista, price_mayorista,
            cost_price, supplier, profit_margin_target, image_path, order_index, stock, is_active, is_featured
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("category_id"),
        data.get("name"),
        data.get("presentation", ""),
        p_min,
        float(data.get("price_mayorista", 0) or 0),
        cost_val,
        str(data.get("supplier", "") or "").strip(),
        margin_val,
        data.get("image_path", ""),
        int(data.get("order_index", 0) or 0),
        int(data.get("stock", 10) if data.get("stock") is not None else 10),
        1 if data.get("is_active", 1) in [1, True, "1", "true"] else 0,
        1 if data.get("is_featured", 0) in [1, True, "1", "true"] else 0
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def update_product(product_id, data):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    stock_val = int(data.get("stock", 10) if data.get("stock") is not None else 10)
    cost_val = float(data.get("cost_price", 0) or 0)
    supplier_val = str(data.get("supplier", "") or "").strip()
    p_min = float(data.get("price_minorista", 0) or 0)
    p_may = float(data.get("price_mayorista", 0) or 0)
    margin_val = float(data.get("profit_margin_target", 0) or 0)
    if margin_val == 0 and cost_val > 0 and p_min > 0:
        margin_val = round(((p_min - cost_val) / p_min) * 100, 1)
    img = data.get("image_path")
    
    if img:
        cursor.execute("""
            UPDATE products SET
                category_id = ?,
                name = ?,
                presentation = ?,
                price_minorista = ?,
                price_mayorista = ?,
                cost_price = ?,
                supplier = ?,
                profit_margin_target = ?,
                image_path = ?,
                order_index = ?,
                stock = ?,
                is_active = ?,
                is_featured = ?
            WHERE id = ?
        """, (
            data.get("category_id"),
            data.get("name"),
            data.get("presentation", ""),
            p_min,
            p_may,
            cost_val,
            supplier_val,
            margin_val,
            img,
            int(data.get("order_index", 0) or 0),
            stock_val,
            1 if data.get("is_active", 1) in [1, True, "1", "true"] else 0,
            1 if data.get("is_featured", 0) in [1, True, "1", "true"] else 0,
            product_id
        ))
    else:
        cursor.execute("""
            UPDATE products SET
                category_id = ?,
                name = ?,
                presentation = ?,
                price_minorista = ?,
                price_mayorista = ?,
                cost_price = ?,
                supplier = ?,
                profit_margin_target = ?,
                order_index = ?,
                stock = ?,
                is_active = ?,
                is_featured = ?
            WHERE id = ?
        """, (
            data.get("category_id"),
            data.get("name"),
            data.get("presentation", ""),
            p_min,
            p_may,
            cost_val,
            supplier_val,
            margin_val,
            int(data.get("order_index", 0) or 0),
            stock_val,
            1 if data.get("is_active", 1) in [1, True, "1", "true"] else 0,
            1 if data.get("is_featured", 0) in [1, True, "1", "true"] else 0,
            product_id
        ))
    conn.commit()
    conn.close()

def update_product_stock(product_id, new_stock):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE products SET stock = ? WHERE id = ?", (int(new_stock), product_id))
    conn.commit()
    conn.close()

def delete_product(product_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
    conn.commit()
    conn.close()

def clear_all_database_data():
    """Borra únicamente los productos de la base de datos, preservando las categorías"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM products")
    cursor.execute("DELETE FROM sqlite_sequence WHERE name = 'products'")
    conn.commit()
    conn.close()

def create_category(name, order_index=0, icon=""):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO categories (name, order_index, icon) VALUES (?, ?, ?)", (name.strip(), order_index, icon))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return new_id

def get_or_create_category(name):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM categories WHERE UPPER(name) = UPPER(?)", (name.strip(),))
    row = cursor.fetchone()
    if row:
        cat_id = row["id"]
    else:
        cursor.execute("SELECT COALESCE(MAX(order_index), 0) + 1 FROM categories")
        next_order = cursor.fetchone()[0]
        cursor.execute("INSERT INTO categories (name, order_index) VALUES (?, ?)", (name.strip(), next_order))
        cat_id = cursor.lastrowid
        conn.commit()
    conn.close()
    return cat_id

def update_category(category_id, name, order_index=0):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE categories SET name = ?, order_index = ? WHERE id = ?", (name.strip(), order_index, category_id))
    conn.commit()
    conn.close()

def delete_category(category_id, reassign_to_id=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    if reassign_to_id:
        cursor.execute("UPDATE products SET category_id = ? WHERE category_id = ?", (reassign_to_id, category_id))
    else:
        cursor.execute("DELETE FROM products WHERE category_id = ?", (category_id,))
    cursor.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    conn.commit()
    conn.close()

def reassign_category_products(from_category_id, to_category_id):
    """Mueve todos los productos de una categoría a otra"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE products SET category_id = ? WHERE category_id = ?", (to_category_id, from_category_id))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected

def swap_category_order(category_id, direction='up'):
    """Intercambia el orden de una categoría con la anterior o siguiente"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, order_index FROM categories ORDER BY order_index ASC, id ASC")
    cats = cursor.fetchall()
    
    cat_ids = [c["id"] for c in cats]
    if category_id not in cat_ids:
        conn.close()
        return
        
    idx = cat_ids.index(category_id)
    if direction == 'up' and idx > 0:
        other_idx = idx - 1
    elif direction == 'down' and idx < len(cat_ids) - 1:
        other_idx = idx + 1
    else:
        conn.close()
        return

    # Normalizar orden secuencial
    for i, c in enumerate(cats):
        cursor.execute("UPDATE categories SET order_index = ? WHERE id = ?", (i * 10, c["id"]))

    # Intercambiar orden de los dos elementos
    curr_id = cat_ids[idx]
    other_id = cat_ids[other_idx]
    cursor.execute("UPDATE categories SET order_index = ? WHERE id = ?", (other_idx * 10, curr_id))
    cursor.execute("UPDATE categories SET order_index = ? WHERE id = ?", (idx * 10, other_id))

    conn.commit()
    conn.close()

def bulk_adjust_prices(category_id=None, percentage=0.0, price_type="both"):
    """
    price_type: 'minorista', 'mayorista', or 'both'
    percentage: e.g. 10.0 for +10%, -5.0 for -5%
    """
    factor = 1.0 + (float(percentage) / 100.0)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    where_clause = ""
    params = []
    if category_id and category_id != 'all':
        where_clause = " WHERE category_id = ?"
        params.append(category_id)
        
    if price_type in ["minorista", "both"]:
        cursor.execute(f"UPDATE products SET price_minorista = ROUND(price_minorista * {factor}, 0){where_clause}", params)
    
    if price_type in ["mayorista", "both"]:
        cursor.execute(f"UPDATE products SET price_mayorista = ROUND(price_mayorista * {factor}, 0){where_clause}", params)
        
    conn.commit()
    conn.close()

# ----------------- GESTIÓN DE VENTAS (PUNTO DE VENTA) -----------------

def create_sale(sale_data, items_data):
    """
    Registra una venta con sus productos y descuenta automáticamente el stock.
    sale_data: {
        'seller_name': str,
        'price_type': str ('minorista', 'mayorista', 'mixto'),
        'payment_method': str ('Efectivo', 'Tarjeta de Débito', 'Tarjeta de Crédito', 'QR mercadopago', etc.),
        'notes': str,
        'subtotal_amount': float,
        'surcharge_pct': float,
        'surcharge_amount': float,
        'total_amount': float,
        'total_items': int
    }
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        subtotal = float(sale_data.get('subtotal_amount', 0.0) or 0.0)
        total = float(sale_data.get('total_amount', 0.0) or 0.0)
        if subtotal <= 0.0 and total > 0.0:
            subtotal = total

        payment_method = sale_data.get('payment_method', 'Efectivo')
        surch_pct = PAYMENT_SURCHARGES.get(payment_method, float(sale_data.get('surcharge_pct', 0.0) or 0.0))
        surch_amt = round(subtotal * (surch_pct / 100.0), 2)
        total = round(subtotal + surch_amt, 2)

        total_cost_acc = 0.0
        processed_items = []

        for item in items_data:
            p_id = item['product_id']
            qty = int(item.get('quantity', 1))
            u_price = float(item.get('unit_price', 0.0))
            subtot = float(item.get('subtotal', u_price * qty))

            # Obtener costo de compra del producto desde la tabla products
            cursor.execute("SELECT cost_price FROM products WHERE id = ?", (p_id,))
            prod_row = cursor.fetchone()
            cost = float(prod_row['cost_price'] or 0.0) if prod_row else 0.0
            if cost <= 0.0:
                cost = float(item.get('cost_price', round(u_price * 0.75, 2)))

            item_profit = round((u_price - cost) * qty, 2)
            total_cost_acc += (cost * qty)

            processed_items.append({
                'product_id': p_id,
                'product_name': item.get('product_name', ''),
                'presentation': item.get('presentation', ''),
                'price_type': item.get('price_type', 'minorista'),
                'unit_price': u_price,
                'cost_price': cost,
                'profit': item_profit,
                'quantity': qty,
                'subtotal': subtot
            })

        total_cost_acc = round(total_cost_acc, 2)
        total_profit = round(total - total_cost_acc, 2)

        cursor.execute("""
        INSERT INTO sales (seller_name, price_type, payment_method, notes, subtotal_amount, surcharge_pct, surcharge_amount, total_amount, total_cost, total_profit, total_items)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            sale_data.get('seller_name', 'General').strip() or 'General',
            sale_data.get('price_type', 'minorista'),
            payment_method,
            sale_data.get('notes', ''),
            subtotal,
            surch_pct,
            surch_amt,
            total,
            total_cost_acc,
            total_profit,
            int(sale_data.get('total_items', sum(it['quantity'] for it in processed_items)))
        ))
        sale_id = cursor.lastrowid

        for it in processed_items:
            cursor.execute("""
            INSERT INTO sale_items (sale_id, product_id, product_name, presentation, price_type, unit_price, cost_price, profit, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sale_id,
                it['product_id'],
                it['product_name'],
                it['presentation'],
                it['price_type'],
                it['unit_price'],
                it['cost_price'],
                it['profit'],
                it['quantity'],
                it['subtotal']
            ))

            # Restar stock automáticamente del producto
            cursor.execute("""
            UPDATE products 
            SET stock = MAX(0, stock - ?) 
            WHERE id = ?
            """, (it['quantity'], it['product_id']))

        conn.commit()
        return sale_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def update_sale(sale_id, update_data):
    """
    Permite modificar el medio de pago y la modalidad (minorista / mayorista) de una venta ya realizada.
    Recalcula automáticamente precios unitarios según catálogo, subtotales, recargos y utilidades.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM sales WHERE id = ?", (sale_id,))
        sale = cursor.fetchone()
        if not sale:
            return None

        new_payment_method = update_data.get('payment_method', sale['payment_method'])
        new_price_type = update_data.get('price_type', sale['price_type'])
        new_seller = update_data.get('seller_name', sale['seller_name'])
        new_notes = update_data.get('notes', sale['notes'])

        cursor.execute("SELECT * FROM sale_items WHERE sale_id = ?", (sale_id,))
        items = cursor.fetchall()

        subtotal_acc = 0.0
        total_cost_acc = 0.0

        for it in items:
            p_id = it['product_id']
            qty = it['quantity']

            # Buscar precios actuales del producto en el catálogo
            cursor.execute("SELECT price_minorista, price_mayorista, cost_price FROM products WHERE id = ?", (p_id,))
            prod = cursor.fetchone()

            if prod:
                cost = float(prod['cost_price'] or 0.0)
                if cost <= 0.0:
                    cost = float(it['cost_price'] or round(it['unit_price'] * 0.75, 2))
                
                if new_price_type == 'mayorista':
                    u_price = float(prod['price_mayorista'] or it['unit_price'])
                else:
                    u_price = float(prod['price_minorista'] or it['unit_price'])
            else:
                cost = float(it['cost_price'] or 0.0)
                u_price = float(it['unit_price'])

            item_subtotal = round(u_price * qty, 2)
            item_profit = round((u_price - cost) * qty, 2)
            subtotal_acc += item_subtotal
            total_cost_acc += (cost * qty)

            cursor.execute("""
            UPDATE sale_items 
            SET price_type = ?, unit_price = ?, subtotal = ?, cost_price = ?, profit = ?
            WHERE id = ?
            """, (new_price_type, u_price, item_subtotal, cost, item_profit, it['id']))

        subtotal_acc = round(subtotal_acc, 2)
        total_cost_acc = round(total_cost_acc, 2)

        # Recálculo de recargos por medio de pago
        surch_pct = PAYMENT_SURCHARGES.get(new_payment_method, 0.0)
        surch_amt = round(subtotal_acc * (surch_pct / 100.0), 2)
        total_amt = round(subtotal_acc + surch_amt, 2)
        total_profit = round(total_amt - total_cost_acc, 2)

        cursor.execute("""
        UPDATE sales
        SET seller_name = ?, price_type = ?, payment_method = ?, notes = ?,
            subtotal_amount = ?, surcharge_pct = ?, surcharge_amount = ?,
            total_amount = ?, total_cost = ?, total_profit = ?
        WHERE id = ?
        """, (
            new_seller, new_price_type, new_payment_method, new_notes,
            subtotal_acc, surch_pct, surch_amt, total_amt,
            total_cost_acc, total_profit, sale_id
        ))

        conn.commit()
        return get_sale_detail(sale_id)
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_sales(limit=100, offset=0, seller_name=None, date_filter=None, query=None):
    """
    Obtiene el listado de ventas ordenadas por fecha reciente, con soporte de filtrado:
    - por fecha local (date_filter)
    - por búsqueda inteligente (query o seller_name): busca en producto vendido (tokens), vendedor, notas, o ticket ID
    - incluye products_summary con la lista de productos de cada ticket
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    sql = """
    SELECT 
        s.*, 
        datetime(s.created_at, '-3 hours') as created_at_local,
        (
            SELECT GROUP_CONCAT(si.product_name || ' (' || si.quantity || ' un.)', ', ')
            FROM sale_items si
            WHERE si.sale_id = s.id
        ) as products_summary
    FROM sales s
    WHERE 1=1
    """
    params = []

    search_term = query if query is not None else seller_name
    if search_term and str(search_term).strip():
        term = str(search_term).strip()
        
        # Verificar si es búsqueda por ID directo (ej: #12 o 12)
        id_search = None
        clean_id_str = term.lstrip('#').strip()
        if clean_id_str.isdigit():
            id_search = int(clean_id_str)

        tokens = [t.lower() for t in term.split() if len(t) > 1]
        
        item_conditions = []
        item_params = []
        for tok in tokens:
            # Tolerancia para variaciones como stela -> stella o artois
            if tok in ('stela', 'artois'):
                tok_sql = '%stella%'
            else:
                tok_sql = f"%{tok}%"
            item_conditions.append("(si.product_name LIKE ? OR si.presentation LIKE ?)")
            item_params.extend([tok_sql, tok_sql])

        if item_conditions:
            subquery = f"""
            s.id IN (
                SELECT si.sale_id 
                FROM sale_items si 
                WHERE {' AND '.join(item_conditions)}
            )
            """
        else:
            subquery = "1=0"

        if id_search is not None:
            sql += f" AND (s.id = ? OR s.seller_name LIKE ? OR s.notes LIKE ? OR {subquery})"
            params.append(id_search)
            params.append(f"%{term}%")
            params.append(f"%{term}%")
            params.extend(item_params)
        else:
            sql += f" AND (s.seller_name LIKE ? OR s.notes LIKE ? OR {subquery})"
            params.append(f"%{term}%")
            params.append(f"%{term}%")
            params.extend(item_params)

    if date_filter:
        sql += " AND date(s.created_at, '-3 hours') = date(?)"
        params.append(date_filter)

    sql += " ORDER BY s.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor.execute(sql, params)
    rows = cursor.fetchall()
    sales = [dict(r) for r in rows]
    conn.close()
    return sales

def get_sale_detail(sale_id):
    """Obtiene la venta y todos los artículos vendidos con hora local, recargos y precios de catálogo para recálculo dinámico"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT *, datetime(created_at, '-3 hours') as created_at_local 
    FROM sales 
    WHERE id = ?
    """, (sale_id,))
    sale_row = cursor.fetchone()
    if not sale_row:
        conn.close()
        return None
        
    sale = dict(sale_row)
    cursor.execute("""
    SELECT 
        si.*,
        COALESCE(p.price_minorista, si.unit_price) as catalog_price_minorista,
        COALESCE(p.price_mayorista, si.unit_price) as catalog_price_mayorista,
        COALESCE(p.cost_price, si.cost_price) as catalog_cost_price
    FROM sale_items si
    LEFT JOIN products p ON si.product_id = p.id
    WHERE si.sale_id = ?
    """, (sale_id,))
    items_rows = cursor.fetchall()
    sale['items'] = [dict(it) for it in items_rows]
    conn.close()
    return sale

def cancel_sale(sale_id):
    """
    Anula una venta y restituye automáticamente el stock a los productos.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM sales WHERE id = ?", (sale_id,))
        sale = cursor.fetchone()
        if not sale or sale['status'] == 'cancelled':
            return False

        # Obtener los productos vendidos y reponer stock
        cursor.execute("SELECT product_id, quantity FROM sale_items WHERE sale_id = ?", (sale_id,))
        items = cursor.fetchall()
        for item in items:
            cursor.execute("""
            UPDATE products 
            SET stock = stock + ? 
            WHERE id = ?
            """, (item['quantity'], item['product_id']))

        # Marcar la venta como anulada
        cursor.execute("UPDATE sales SET status = 'cancelled' WHERE id = ?", (sale_id,))
        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_sales_summary(date_filter=None, month_filter=None):
    """
    Retorna métricas clave de facturación, costos y ganancias:
    - hoy (día actual)
    - ayer (día anterior)
    - semana (lunes al día actual)
    - mes (primer día del mes al día actual)
    - año (primer día del año al día actual)
    - histórico (acumulado total desde el inicio)
    - custom_date (si se especifica fecha YYYY-MM-DD)
    - custom_month (si se especifica mes YYYY-MM)
    """
    from datetime import datetime, timedelta

    conn = get_db_connection()
    cursor = conn.cursor()

    now = get_now_ar()
    today_str = now.strftime('%Y-%m-%d')
    yesterday_str = (now - timedelta(days=1)).strftime('%Y-%m-%d')
    start_of_week = (now - timedelta(days=now.weekday())).strftime('%Y-%m-%d')
    start_of_month = now.strftime('%Y-%m-01')
    start_of_year = now.strftime('%Y-01-01')

    def query_stats(where_sql, params=()):
        cursor.execute(f"""
        SELECT 
            COALESCE(SUM(total_amount), 0.0) as total,
            COALESCE(SUM(total_cost), 0.0) as cost,
            COALESCE(SUM(total_profit), 0.0) as profit,
            COUNT(id) as count,
            COALESCE(SUM(total_items), 0) as items,
            COALESCE(AVG(total_amount), 0.0) as average,
            COALESCE(AVG(total_profit), 0.0) as avg_profit
        FROM sales 
        WHERE status = 'completed' AND {where_sql}
        """, params)
        res = dict(cursor.fetchone())
        res['total'] = round(float(res.get('total', 0.0) or 0.0), 2)
        res['cost'] = round(float(res.get('cost', 0.0) or 0.0), 2)
        res['profit'] = round(float(res.get('profit', 0.0) or 0.0), 2)
        res['count'] = int(res.get('count', 0) or 0)
        res['items'] = int(res.get('items', 0) or 0)
        res['average'] = round(float(res.get('average', 0.0) or 0.0), 2)
        res['avg_profit'] = round(float(res.get('avg_profit', 0.0) or 0.0), 2)
        
        # Margen porcentual sobre total facturado
        if res['total'] > 0:
            res['margin_pct'] = round((res['profit'] / res['total']) * 100.0, 1)
        else:
            res['margin_pct'] = 0.0
        return res

    today = query_stats("date(created_at, '-3 hours') = date(?)", (today_str,))
    yesterday = query_stats("date(created_at, '-3 hours') = date(?)", (yesterday_str,))
    week = query_stats("(date(created_at, '-3 hours') >= date(?) AND date(created_at, '-3 hours') <= date(?))", (start_of_week, today_str))
    month = query_stats("(date(created_at, '-3 hours') >= date(?) AND date(created_at, '-3 hours') <= date(?))", (start_of_month, today_str))
    year = query_stats("(date(created_at, '-3 hours') >= date(?) AND date(created_at, '-3 hours') <= date(?))", (start_of_year, today_str))
    historical = query_stats("1=1")
    historical['total_all'] = historical['total']
    historical['count_all'] = historical['count']
    historical['items_all'] = historical['items']
    historical['profit_all'] = historical['profit']

    custom_date = None
    if date_filter:
        custom_date = query_stats("date(created_at, '-3 hours') = date(?)", (date_filter,))

    custom_month = None
    if month_filter:
        custom_month = query_stats("strftime('%Y-%m', created_at, '-3 hours') = ?", (month_filter,))

    conn.close()

    today['total_today'] = today['total']
    today['count_today'] = today['count']
    today['items_today'] = today['items']

    return {
        "today": today,
        "yesterday": yesterday,
        "week": week,
        "month": month,
        "year": year,
        "historical": historical,
        "custom_date": custom_date,
        "custom_month": custom_month
    }

def get_profit_breakdown(period='today', month=None, date=None):
    """
    Retorna el desglose detallado de utilidad por cada producto vendido en un período:
    - 'today', 'yesterday', 'week', 'month', 'year', 'historical', o por mes 'YYYY-MM' o fecha 'YYYY-MM-DD'.
    Incluye:
    - Unidades vendidas
    - Costo de compra unitario promedio
    - Precio de venta unitario promedio
    - Utilidad neta por unidad
    - Margen %
    - Ganancia total acumulada
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    now = get_now_ar()
    today_str = now.strftime('%Y-%m-%d')
    yesterday_str = (now - timedelta(days=1)).strftime('%Y-%m-%d')
    start_of_week = (now - timedelta(days=now.weekday())).strftime('%Y-%m-%d')
    start_of_month = now.strftime('%Y-%m-01')
    start_of_year = now.strftime('%Y-01-01')

    where_clause = "s.status = 'completed'"
    params = []

    if date:
        where_clause += " AND date(s.created_at, '-3 hours') = date(?)"
        params.append(date)
    elif month:
        where_clause += " AND strftime('%Y-%m', s.created_at, '-3 hours') = ?"
        params.append(month)
    elif period == 'today':
        where_clause += " AND date(s.created_at, '-3 hours') = date(?)"
        params.append(today_str)
    elif period == 'yesterday':
        where_clause += " AND date(s.created_at, '-3 hours') = date(?)"
        params.append(yesterday_str)
    elif period == 'week':
        where_clause += " AND (date(s.created_at, '-3 hours') >= date(?) AND date(s.created_at, '-3 hours') <= date(?))"
        params.extend([start_of_week, today_str])
    elif period == 'month':
        where_clause += " AND (date(s.created_at, '-3 hours') >= date(?) AND date(s.created_at, '-3 hours') <= date(?))"
        params.extend([start_of_month, today_str])
    elif period == 'year':
        where_clause += " AND (date(s.created_at, '-3 hours') >= date(?) AND date(s.created_at, '-3 hours') <= date(?))"
        params.extend([start_of_year, today_str])
    elif period == 'historical':
        pass

    query = f"""
    SELECT 
        si.product_id,
        si.product_name,
        si.presentation,
        SUM(si.quantity) as total_quantity,
        ROUND(AVG(si.cost_price), 2) as avg_cost,
        ROUND(SUM(si.subtotal) * 1.0 / SUM(si.quantity), 2) as avg_price,
        ROUND((SUM(si.subtotal) - SUM(si.cost_price * si.quantity)) * 1.0 / SUM(si.quantity), 2) as unit_profit,
        ROUND(SUM(si.cost_price * si.quantity), 2) as total_cost,
        ROUND(SUM(si.subtotal), 2) as total_revenue,
        ROUND(SUM(si.profit), 2) as total_profit,
        CASE 
            WHEN SUM(si.subtotal) > 0 
            THEN ROUND(((SUM(si.subtotal) - SUM(si.cost_price * si.quantity)) / SUM(si.subtotal)) * 100.0, 1)
            ELSE 0.0 
        END as margin_pct
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    WHERE {where_clause}
    GROUP BY si.product_id, si.product_name, si.presentation
    ORDER BY total_profit DESC, total_quantity DESC
    """

    cursor.execute(query, params)
    products_breakdown = [dict(r) for r in cursor.fetchall()]

    # Totales globales del período
    summary_query = f"""
    SELECT 
        COALESCE(SUM(s.total_amount), 0.0) as total_revenue,
        COALESCE(SUM(s.total_cost), 0.0) as total_cost,
        COALESCE(SUM(s.total_profit), 0.0) as total_profit,
        COALESCE(SUM(s.total_items), 0) as total_items,
        COUNT(s.id) as total_sales
    FROM sales s
    WHERE {where_clause}
    """
    cursor.execute(summary_query, params)
    totals_row = cursor.fetchone()
    totals = dict(totals_row) if totals_row else {
        "total_revenue": 0.0, "total_cost": 0.0, "total_profit": 0.0, "total_items": 0, "total_sales": 0
    }
    
    rev = float(totals.get('total_revenue', 0.0) or 0.0)
    prof = float(totals.get('total_profit', 0.0) or 0.0)
    totals['margin_pct'] = round((prof / rev) * 100.0, 1) if rev > 0 else 0.0
    totals['total_revenue'] = round(rev, 2)
    totals['total_cost'] = round(float(totals.get('total_cost', 0.0) or 0.0), 2)
    totals['total_profit'] = round(prof, 2)

    conn.close()

    return {
        "period": period,
        "date": date,
        "month": month,
        "totals": totals,
        "products": products_breakdown
    }


# =====================================================================
# MOTOR DE SINCRONIZACIÓN LOCAL <-> NUBE (WEB)
# =====================================================================

def get_sync_status():
    """Retorna un resumen del estado actual de la base de datos para sincronización"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT COALESCE(MAX(id), 0), COUNT(id) FROM sales")
    last_sale_id, total_sales = cursor.fetchone()
    
    cursor.execute("SELECT COUNT(id), COALESCE(SUM(stock), 0) FROM products")
    total_products, total_stock = cursor.fetchone()
    
    cursor.execute("SELECT COALESCE(MAX(created_at), '') FROM sales")
    last_sale_date = cursor.fetchone()[0]
    
    conn.close()
    return {
        "last_sale_id": last_sale_id,
        "total_sales": total_sales,
        "total_products": total_products,
        "total_stock": total_stock,
        "last_sale_date": last_sale_date,
        "server_time": get_now_ar().strftime('%Y-%m-%d %H:%M:%S')
    }

def get_sync_export_payload(since_sale_id=0):
    """Genera el paquete de datos completo para sincronizar hacia el otro servidor"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Ventas nuevas posteriores a since_sale_id
    cursor.execute("SELECT * FROM sales WHERE id > ? ORDER BY id ASC", (since_sale_id,))
    sales = [dict(r) for r in cursor.fetchall()]
    
    sale_ids = [s['id'] for s in sales]
    sale_items = []
    if sale_ids:
        placeholders = ','.join(['?'] * len(sale_ids))
        cursor.execute(f"SELECT * FROM sale_items WHERE sale_id IN ({placeholders}) ORDER BY id ASC", sale_ids)
        sale_items = [dict(r) for r in cursor.fetchall()]
        
    # 2. Estado actual de productos (stock, precios, costos, catálogo)
    cursor.execute("SELECT * FROM products ORDER BY id ASC")
    products = [dict(r) for r in cursor.fetchall()]
    
    # 3. Categorías
    cursor.execute("SELECT * FROM categories ORDER BY id ASC")
    categories = [dict(r) for r in cursor.fetchall()]
    
    # 4. Configuraciones generales
    cursor.execute("SELECT key, value FROM settings")
    settings = {r['key']: r['value'] for r in cursor.fetchall()}
    
    conn.close()
    return {
        "status": get_sync_status(),
        "sales": sales,
        "sale_items": sale_items,
        "products": products,
        "categories": categories,
        "settings": settings
    }

def apply_sync_payload(payload):
    """Aplica de manera segura el paquete de sincronización recibido"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    imported_sales = 0
    updated_products = 0
    
    # 1. Sincronizar Categorías
    categories = payload.get('categories', [])
    for c in categories:
        cursor.execute("""
            INSERT INTO categories (id, name, order_index, icon)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                order_index = excluded.order_index,
                icon = excluded.icon
        """, (c.get('id'), c.get('name'), c.get('order_index', 0), c.get('icon', '')))
        
    # 2. Sincronizar Productos (Precios, Stock, Costos)
    products = payload.get('products', [])
    for p in products:
        cursor.execute("""
            INSERT INTO products (
                id, category_id, name, presentation, price_minorista, price_mayorista,
                cost_price, supplier, profit_margin_target, image_path, order_index,
                stock, is_active, is_featured
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                category_id = excluded.category_id,
                name = excluded.name,
                presentation = excluded.presentation,
                price_minorista = excluded.price_minorista,
                price_mayorista = excluded.price_mayorista,
                cost_price = excluded.cost_price,
                supplier = excluded.supplier,
                profit_margin_target = excluded.profit_margin_target,
                stock = excluded.stock,
                is_active = excluded.is_active,
                is_featured = excluded.is_featured
        """, (
            p.get('id'), p.get('category_id'), p.get('name'), p.get('presentation', ''),
            float(p.get('price_minorista', 0) or 0), float(p.get('price_mayorista', 0) or 0),
            float(p.get('cost_price', 0) or 0), str(p.get('supplier', '') or ''),
            float(p.get('profit_margin_target', 0) or 0), str(p.get('image_path', '') or ''),
            int(p.get('order_index', 0) or 0), int(p.get('stock', 0) or 0),
            int(p.get('is_active', 1) or 0), int(p.get('is_featured', 0) or 0)
        ))
        updated_products += 1

    # 3. Sincronizar Ventas (sales)
    sales = payload.get('sales', [])
    for s in sales:
        cursor.execute("""
            INSERT OR IGNORE INTO sales (
                id, seller_name, price_type, payment_method, notes,
                subtotal_amount, surcharge_pct, surcharge_amount,
                total_amount, total_cost, total_profit, total_items,
                status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            s.get('id'), s.get('seller_name', 'General'), s.get('price_type', 'minorista'),
            s.get('payment_method', 'Efectivo'), s.get('notes', ''),
            float(s.get('subtotal_amount', 0) or 0), float(s.get('surcharge_pct', 0) or 0),
            float(s.get('surcharge_amount', 0) or 0), float(s.get('total_amount', 0) or 0),
            float(s.get('total_cost', 0) or 0), float(s.get('total_profit', 0) or 0),
            int(s.get('total_items', 1) or 1), s.get('status', 'completed'),
            s.get('created_at')
        ))
        if cursor.rowcount > 0:
            imported_sales += 1
            
    # 4. Sincronizar Items de Venta (sale_items)
    items = payload.get('sale_items', [])
    for it in items:
        cursor.execute("""
            INSERT OR IGNORE INTO sale_items (
                id, sale_id, product_id, product_name, presentation,
                price_type, unit_price, cost_price, profit, quantity, subtotal
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            it.get('id'), it.get('sale_id'), it.get('product_id'),
            it.get('product_name', ''), it.get('presentation', ''),
            it.get('price_type', 'minorista'), float(it.get('unit_price', 0) or 0),
            float(it.get('cost_price', 0) or 0), float(it.get('profit', 0) or 0),
            int(it.get('quantity', 1) or 1), float(it.get('subtotal', 0) or 0)
        ))

    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "imported_sales": imported_sales,
        "updated_products": updated_products,
        "synced_at": get_now_ar().strftime('%Y-%m-%d %H:%M:%S')
    }

def replace_db_from_bytes(data_bytes):
    """Reemplaza catalogo.db de forma atómica y segura con una copia binaria recibida"""
    import shutil
    if len(data_bytes) < 1000:
        raise ValueError("El archivo recibido es demasiado pequeño para ser una base de datos válida")
    
    temp_path = DB_PATH + ".sync_temp"
    with open(temp_path, "wb") as f:
        f.write(data_bytes)
        
    temp_conn = sqlite3.connect(temp_path)
    res = temp_conn.execute("PRAGMA integrity_check").fetchone()
    temp_conn.close()
    if not res or res[0] != "ok":
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise ValueError("La base de datos recibida está corrupta o no pasó el integrity check")
        
    bak_path = DB_PATH + ".bak"
    try:
        if os.path.exists(bak_path):
            os.remove(bak_path)
        if os.path.exists(DB_PATH):
            os.rename(DB_PATH, bak_path)
    except Exception:
        pass
        
    shutil.move(temp_path, DB_PATH)
    return True
