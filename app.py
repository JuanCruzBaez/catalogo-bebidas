import os
import io
import csv
import json
import socket
import webbrowser
import threading
from datetime import datetime, timedelta
from flask import (
    Flask, render_template, request, jsonify, send_file, send_from_directory, redirect, url_for, session
)
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

import database
import pdf_generator

app = Flask(__name__)
app.config['SECRET_KEY'] = 'catalogo-bebidas-secret-2026'
app.permanent_session_lifetime = timedelta(days=14)
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32MB max upload
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# ----------------- AUTENTICACIÓN Y SEGURIDAD ADMIN -----------------

@app.before_request
def require_admin_auth():
    path = request.path
    
    # Rutas públicas (clientes, fotos, estilos y login)
    if (
        path in ['/', '/tienda', '/login', '/logout'] or
        path.startswith('/static/') or
        path.startswith('/uploads/') or
        path.startswith('/api/public/')
    ):
        return None
        
    # Cualquier otra ruta (panel de stock, costos, ventas POS, gestión interna) requiere ser admin
    if not session.get('is_admin'):
        if path.startswith('/api/'):
            return jsonify({
                "error": "Acceso restringido. Inicie sesión como administrador.",
                "login_url": url_for('login')
            }), 401
        return redirect(url_for('login', next=path))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('is_admin'):
        return redirect(url_for('admin'))
        
    error = None
    if request.method == 'POST':
        password = (request.form.get('password') or '').strip()
        settings = database.get_all_settings()
        stored_hash = settings.get('admin_password_hash')
        env_pass = os.environ.get('ADMIN_PASSWORD')
        
        authenticated = False
        if env_pass and password == env_pass:
            authenticated = True
        elif stored_hash:
            if check_password_hash(stored_hash, password):
                authenticated = True
        else:
            default_pass = settings.get('admin_password', '25demayo2026')
            if password == default_pass:
                authenticated = True
                
        if authenticated:
            session['is_admin'] = True
            session.permanent = True
            next_url = request.args.get('next')
            if next_url and next_url.startswith('/') and not next_url.startswith('//'):
                return redirect(next_url)
            return redirect(url_for('admin'))
        else:
            error = 'Contraseña incorrecta. Por favor intente nuevamente.'
            
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.pop('is_admin', None)
    return redirect(url_for('login'))

@app.route('/api/admin/change-password', methods=['POST'])
def api_change_password():
    if not session.get('is_admin'):
        return jsonify({"error": "No autorizado"}), 401
        
    data = request.get_json() or {}
    new_password = (data.get('new_password') or '').strip()
    
    if len(new_password) < 4:
        return jsonify({"error": "La contraseña debe tener al menos 4 caracteres"}), 400
        
    p_hash = generate_password_hash(new_password)
    database.update_settings({
        "admin_password_hash": p_hash,
        "admin_password": new_password
    })
    return jsonify({"success": True, "message": "Contraseña de administrador actualizada correctamente"})

# ----------------- RUTAS DE VISTA Y ESTÁTICOS -----------------

@app.route('/')
@app.route('/tienda')
def tienda():
    """Página web principal de cara a los clientes (catálogo, combos, carrito y pedidos WhatsApp/Email)"""
    return render_template('tienda.html')

@app.route('/admin')
@app.route('/pos')
def admin():
    """Panel de administración interno, control de inventario, costos, proveedores y punto de venta (POS)"""
    return render_template('index.html')

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ----------------- API PÚBLICA (SEGURA PARA CLIENTES) -----------------

@app.route('/api/public/products', methods=['GET'])
def api_public_products():
    """Endpoint público: devuelve catálogo sin costos, sin proveedores y con stock ofuscado"""
    category_id = request.args.get('category_id', type=int)
    query = request.args.get('q', type=str)
    products = database.get_public_products(category_id=category_id, query=query)
    return jsonify(products)

@app.route('/api/public/combos', methods=['GET'])
def api_public_combos():
    """Endpoint público: devuelve combos de bebidas prearmados"""
    combos = database.get_public_combos()
    return jsonify(combos)

@app.route('/api/public/categories', methods=['GET'])
def api_public_categories():
    """Endpoint público: devuelve categorías con productos activos"""
    cats = database.get_public_categories()
    return jsonify(cats)

@app.route('/api/public/info', methods=['GET'])
def api_public_info():
    """Endpoint público: información de contacto oficial del negocio"""
    settings = database.get_all_settings()
    return jsonify({
        "business_name": settings.get("business_name", "BEBIDAS 25 DE MAYO"),
        "slogan": settings.get("banner_phrase", "PARA TU NEGOCIO Y PARA VOS"),
        "address": "Av. 25 de Mayo 434, Lanús Oeste",
        "whatsapp_display": "11 7626-5350",
        "whatsapp_phone": "5491176265350",
        "whatsapp_url": "https://wa.me/5491176265350",
        "email": "bebidas.25demayo@hotmail.com",
        "instagram": "@bebidas25demayo",
        "instagram_url": "https://instagram.com/bebidas25demayo",
        "hours": "Lunes a Sábados de 09:30 a 21:30 hs",
        "delivery_info": "Envíos a domicilio por Lanús",
        "wholesale_threshold": 100000,
        "wholesale_condition": "Precios mayoristas a partir de los $100.000",
        "website_url": "https://bebidas-25-de-mayo.com.ar"
    })

# ----------------- API COMBOS (GESTIÓN ADMIN) -----------------

@app.route('/api/combos', methods=['GET'])
def api_get_combos():
    return jsonify(database.get_combos())

@app.route('/api/combos', methods=['POST'])
def api_create_combo():
    data = request.get_json() or {}
    combo_id = database.create_combo(data)
    return jsonify({"success": True, "id": combo_id}), 201

@app.route('/api/combos/<int:combo_id>', methods=['PUT'])
def api_update_combo(combo_id):
    data = request.get_json() or {}
    database.update_combo(combo_id, data)
    return jsonify({"success": True, "message": "Combo actualizado"})

@app.route('/api/combos/<int:combo_id>', methods=['DELETE'])
def api_delete_combo(combo_id):
    database.delete_combo(combo_id)
    return jsonify({"success": True, "message": "Combo eliminado"})

# ----------------- API PRODUCTOS (ADMIN / INTERNO) -----------------

@app.route('/api/products', methods=['GET'])
def api_get_products():
    category_id = request.args.get('category_id', type=int)
    query = request.args.get('q', type=str)
    active_only = request.args.get('active_only', default=False, type=lambda v: v.lower() == 'true')
    
    products = database.get_products(category_id=category_id, query=query, active_only=active_only)
    return jsonify(products)

@app.route('/api/products', methods=['POST'])
def api_create_product():
    # Soporta tanto multipart/form-data (con foto) como JSON
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form.to_dict()

    image_path = ""
    if 'image' in request.files:
        file = request.files['image']
        if file and allowed_file(file.filename):
            filename = f"prod_{int(datetime.now().timestamp())}_{secure_filename(file.filename)}"
            save_dest = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(save_dest)
            image_path = f"uploads/{filename}"

    if image_path:
        data['image_path'] = image_path

    # Cálculos automáticos de escalas si no vienen especificados
    p_may = float(data.get('price_mayorista', 0) or 0)
    if not data.get('wholesale_tier1_price') and p_may > 0:
        data['wholesale_tier1_price'] = round(p_may * 0.97, 0)
    if not data.get('wholesale_tier2_price') and p_may > 0:
        data['wholesale_tier2_price'] = round(p_may * 0.95, 0)

    prod_id = database.create_product(data)
    new_product = database.get_product(prod_id)
    return jsonify({"success": True, "product": new_product}), 201

@app.route('/api/products/<int:prod_id>', methods=['GET'])
def api_get_product(prod_id):
    prod = database.get_product(prod_id)
    if not prod:
        return jsonify({"error": "Producto no encontrado"}), 404
    return jsonify(prod)

@app.route('/api/products/<int:prod_id>', methods=['PUT', 'POST'])
def api_update_product(prod_id):
    if request.is_json:
        data = request.get_json()
    else:
        data = request.form.to_dict()

    image_path = ""
    if 'image' in request.files:
        file = request.files['image']
        if file and allowed_file(file.filename):
            filename = f"prod_{int(datetime.now().timestamp())}_{secure_filename(file.filename)}"
            save_dest = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(save_dest)
            image_path = f"uploads/{filename}"
            data['image_path'] = image_path

    database.update_product(prod_id, data)
    updated = database.get_product(prod_id)
    return jsonify({"success": True, "product": updated})

@app.route('/api/products/<int:prod_id>', methods=['DELETE'])
def api_delete_product(prod_id):
    database.delete_product(prod_id)
    return jsonify({"success": True, "message": "Producto eliminado"})

@app.route('/api/products/<int:prod_id>/duplicate', methods=['POST'])
def api_duplicate_product(prod_id):
    prod = database.get_product(prod_id)
    if not prod:
        return jsonify({"error": "Producto no encontrado"}), 404
    
    prod_data = dict(prod)
    prod_data.pop('id', None)
    prod_data['name'] = f"{prod_data['name']} (Copia)"
    
    new_id = database.create_product(prod_data)
    new_prod = database.get_product(new_id)
    return jsonify({"success": True, "product": new_prod}), 201

@app.route('/api/products/<int:prod_id>/toggle-active', methods=['POST'])
def api_toggle_active(prod_id):
    prod = database.get_product(prod_id)
    if not prod:
        return jsonify({"error": "Producto no encontrado"}), 404
    
    new_status = 0 if prod['is_active'] == 1 else 1
    prod_data = dict(prod)
    prod_data['is_active'] = new_status
    database.update_product(prod_id, prod_data)
    return jsonify({"success": True, "is_active": new_status})

@app.route('/api/products/<int:prod_id>/stock', methods=['POST'])
def api_update_product_stock(prod_id):
    data = request.get_json() or {}
    new_stock = int(data.get('stock', 0))
    database.update_product_stock(prod_id, new_stock)
    return jsonify({"success": True, "stock": new_stock})

# ----------------- AJUSTE MASIVO DE PRECIOS -----------------

@app.route('/api/products/bulk-price-adjustment', methods=['POST'])
def api_bulk_adjustment():
    data = request.get_json() or {}
    category_id = data.get('category_id') # None o int
    if category_id == '' or category_id == 'all':
        category_id = None
    elif category_id:
        category_id = int(category_id)

    percentage = float(data.get('percentage', 0))
    price_type = data.get('price_type', 'both') # 'minorista', 'mayorista', 'both'

    database.bulk_adjust_prices(category_id=category_id, percentage=percentage, price_type=price_type)
    return jsonify({"success": True, "message": f"Precios actualizados en un {percentage:+}%"})

# ----------------- API CATEGORÍAS -----------------

@app.route('/api/categories', methods=['GET'])
def api_get_categories():
    categories = database.get_categories()
    return jsonify(categories)

@app.route('/api/categories', methods=['POST'])
def api_create_category():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"error": "El nombre de la categoría es obligatorio"}), 400
    
    cat_id = database.create_category(name, order_index=int(data.get('order_index', 0) or 0), icon=data.get('icon', ''))
    return jsonify({"success": True, "id": cat_id, "name": name}), 201

@app.route('/api/categories/<int:cat_id>', methods=['PUT'])
def api_update_category(cat_id):
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    order_index = int(data.get('order_index', 0) or 0)
    database.update_category(cat_id, name, order_index)
    return jsonify({"success": True, "message": "Categoría actualizada"})

@app.route('/api/categories/<int:cat_id>', methods=['DELETE'])
def api_delete_category(cat_id):
    reassign_to = request.args.get('reassign_to_id')
    if reassign_to:
        reassign_to = int(reassign_to)
    database.delete_category(cat_id, reassign_to_id=reassign_to)
    return jsonify({"success": True, "message": "Categoría eliminada"})

@app.route('/api/categories/<int:cat_id>/reassign', methods=['POST'])
def api_reassign_category_products(cat_id):
    data = request.get_json() or {}
    to_id = data.get('to_category_id')
    if not to_id:
        return jsonify({"error": "Debes especificar la categoría destino"}), 400
    
    count = database.reassign_category_products(cat_id, int(to_id))
    return jsonify({"success": True, "reassigned_count": count, "message": f"Se movieron {count} productos correctamente"})

@app.route('/api/categories/<int:cat_id>/swap-order', methods=['POST'])
def api_swap_category_order(cat_id):
    data = request.get_json() or {}
    direction = data.get('direction', 'up')
    database.swap_category_order(cat_id, direction)
    return jsonify({"success": True, "categories": database.get_categories()})

# ----------------- API CONFIGURACIÓN Y NEGOCIO -----------------

@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    settings = database.get_all_settings()
    return jsonify(settings)

@app.route('/api/settings', methods=['POST'])
def api_update_settings():
    data = request.get_json() or {}
    database.update_settings(data)
    return jsonify({"success": True, "settings": database.get_all_settings()})

@app.route('/api/settings/upload-logo', methods=['POST'])
def api_upload_logo():
    if 'logo' not in request.files:
        return jsonify({"error": "No se envió ningún archivo de logo"}), 400
    
    file = request.files['logo']
    if file and allowed_file(file.filename):
        ext = file.filename.rsplit('.', 1)[1].lower()
        filename = f"logo_{int(datetime.now().timestamp())}.{ext}"
        save_dest = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(save_dest)
        
        logo_rel_path = f"uploads/{filename}"
        database.update_settings({"logo_path": logo_rel_path})
        return jsonify({"success": True, "logo_path": logo_rel_path})
    
    return jsonify({"error": "Formato de imagen no válido"}), 400

# ----------------- API GENERACIÓN Y EXPORTACIÓN DE PDF -----------------

@app.route('/api/export-pdf/<catalog_type>', methods=['GET'])
def api_export_pdf(catalog_type):
    """
    catalog_type: 'minorista' o 'mayorista'
    query param 'preview': si es 'true', devuelve el PDF inline para visor web; si no, descarga como archivo.
    query param 'style': 'list' o 'cards' (opcional, para forzar estilo)
    """
    if catalog_type not in ['minorista', 'mayorista', 'combinado']:
        catalog_type = 'minorista'

    is_preview = request.args.get('preview', default='false').lower() == 'true'
    style_override = request.args.get('style')

    if style_override == 'cards':
        pdf_bytes = pdf_generator.generate_cards_pdf(catalog_type)
    elif style_override == 'list':
        pdf_bytes = pdf_generator.generate_list_pdf(catalog_type)
    else:
        pdf_bytes = pdf_generator.generate_pdf(catalog_type)

    settings = database.get_all_settings()
    biz_name_slug = secure_filename(settings.get('business_name', 'Catalogo')).replace(' ', '_')
    date_slug = datetime.now().strftime('%Y%m%d')
    filename = f"{biz_name_slug}_{catalog_type.upper()}_{date_slug}.pdf"

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=not is_preview,
        download_name=filename
    )

# ----------------- API IMPORTACIÓN / EXPORTACIÓN CSV -----------------

@app.route('/api/backup/export-csv', methods=['GET'])
def api_export_csv():
    products = database.get_products()
    
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow([
        'ID', 'Categoría', 'Nombre', 'Presentación', 
        'Precio Minorista', 'Precio Mayorista', 'Costo', 'Proveedor', 'Stock', 'Activo'
    ])

    for p in products:
        writer.writerow([
            p['id'],
            p['category_name'],
            p['name'],
            p['presentation'],
            p['price_minorista'],
            p['price_mayorista'],
            p.get('cost_price', 0.0),
            p.get('supplier', ''),
            p.get('stock', 10),
            'SI' if p['is_active'] == 1 else 'NO'
        ])

    csv_data = output.getvalue().encode('utf-8-sig') # UTF-8 con BOM para que abra perfecto en Excel Windows
    return send_file(
        io.BytesIO(csv_data),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f"inventario_bebidas_{datetime.now().strftime('%Y%m%d')}.csv"
    )

@app.route('/api/backup/import-csv', methods=['POST'])
def api_import_csv():
    if 'file' not in request.files:
        return jsonify({"error": "No se seleccionó ningún archivo"}), 400
    
    file = request.files['file']
    if not file.filename.endswith(('.csv', '.txt')):
        return jsonify({"error": "Por favor suba un archivo CSV (.csv)"}), 400

    content = file.stream.read().decode('utf-8-sig', errors='replace')
    delimiter = ';' if ';' in content else ','
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    
    count = 0
    for row in reader:
        cat_name = row.get('Categoría') or row.get('Categoria') or row.get('category') or 'GENERAL'
        name = row.get('Nombre') or row.get('name') or ''
        if not name:
            continue
            
        presentation = row.get('Presentación') or row.get('Presentacion') or row.get('presentation') or ''
        
        def parse_float(val):
            try:
                return float(str(val).replace('$', '').replace('.', '').replace(',', '.').strip())
            except Exception:
                return 0.0

        def parse_int(val, default=10):
            try:
                return int(val)
            except Exception:
                return default

        p_min = parse_float(row.get('Precio Minorista') or row.get('price_minorista') or 0)
        p_may = parse_float(row.get('Precio Mayorista') or row.get('price_mayorista') or 0)
        cost_val = parse_float(row.get('Costo') or row.get('cost_price') or row.get('Precio Costo') or 0)
        supplier_val = str(row.get('Proveedor') or row.get('supplier') or '').strip()
        stock_val = parse_int(row.get('Stock') or row.get('stock') or 10)
        
        active_val = str(row.get('Activo', 'SI')).strip().upper()
        is_active = 1 if active_val in ['SI', '1', 'TRUE', 'S', 'ACTIVO'] else 0

        cat_id = database.get_or_create_category(cat_name)
        database.create_product({
            'category_id': cat_id,
            'name': name,
            'presentation': presentation,
            'price_minorista': p_min,
            'price_mayorista': p_may,
            'cost_price': cost_val,
            'supplier': supplier_val,
            'stock': stock_val,
            'is_active': is_active
        })
        count += 1

    return jsonify({"success": True, "imported_count": count})

# ----------------- VACIADO Y RESTAURACIÓN DE BASE DE DATOS -----------------

@app.route('/api/database/clear', methods=['POST'])
def api_clear_database():
    data = request.get_json() or {}
    confirmation = str(data.get('confirmation', '')).strip().upper()
    if confirmation != 'BORRAR':
        return jsonify({"error": "Debes escribir la palabra BORRAR para confirmar el vaciado"}), 400

    database.clear_all_database_data()
    return jsonify({"success": True, "message": "Todos los productos han sido eliminados correctamente (las categorías se mantienen)"})

@app.route('/api/database/restore-sample', methods=['POST'])
def api_restore_sample_database():
    import seed_data
    database.clear_all_database_data()
    seed_data.seed_database()
    return jsonify({"success": True, "message": "Se han restaurado los 95 productos de ejemplo con éxito"})

# ----------------- ENDPOINTS DE GESTIÓN DE VENTAS -----------------

@app.route('/api/sales', methods=['GET'])
def api_get_sales():
    limit = request.args.get('limit', default=150, type=int)
    offset = request.args.get('offset', default=0, type=int)
    seller_name = request.args.get('seller_name', default=None)
    date_filter = request.args.get('date', default=None)
    q = request.args.get('q', default=None)
    
    sales = database.get_sales(limit=limit, offset=offset, seller_name=seller_name, date_filter=date_filter, query=q)
    return jsonify({"success": True, "sales": sales})

@app.route('/api/sales', methods=['POST'])
def api_create_sale():
    data = request.get_json() or {}
    items = data.get('items', [])
    
    if not items:
        return jsonify({"error": "Debe agregar al menos un producto a la venta"}), 400

    seller_name = str(data.get('seller_name', 'General')).strip()
    if not seller_name:
        seller_name = 'General'

    # Validar stock disponible para cada producto
    for item in items:
        p_id = item.get('product_id')
        qty = int(item.get('quantity', 1))
        prod = database.get_product(p_id)
        if not prod:
            return jsonify({"error": f"Producto ID {p_id} no encontrado"}), 404
        if prod.get('stock', 0) < qty:
            return jsonify({
                "error": f"Stock insuficiente para '{prod['name']}'. Disponible: {prod.get('stock', 0)}, Solicitado: {qty}"
            }), 400

    try:
        subtotal_val = float(data.get('subtotal_amount', data.get('total_amount', 0.0)) or 0.0)
        total_val = float(data.get('total_amount', 0.0) or 0.0)
        if subtotal_val <= 0.0 and total_val > 0.0:
            subtotal_val = total_val

        sale_data = {
            'seller_name': seller_name,
            'price_type': data.get('price_type', 'minorista'),
            'payment_method': data.get('payment_method', 'Efectivo'),
            'notes': data.get('notes', ''),
            'subtotal_amount': subtotal_val,
            'surcharge_pct': float(data.get('surcharge_pct', 0.0) or 0.0),
            'surcharge_amount': float(data.get('surcharge_amount', 0.0) or 0.0),
            'total_amount': total_val,
            'total_items': data.get('total_items', sum(int(it.get('quantity', 1)) for it in items))
        }
        sale_id = database.create_sale(sale_data, items)
        
        # Devolver la venta creada y productos actualizados para refrescar stock en frontend
        sale_detail = database.get_sale_detail(sale_id)
        updated_products = [database.get_product(it['product_id']) for it in items]
        
        return jsonify({
            "success": True, 
            "sale": sale_detail,
            "updated_products": updated_products,
            "message": "Venta registrada con éxito y stock descontado"
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/sales/<int:sale_id>', methods=['GET'])
def api_get_sale(sale_id):
    sale = database.get_sale_detail(sale_id)
    if not sale:
        return jsonify({"error": "Venta no encontrada"}), 404
    return jsonify({"success": True, "sale": sale})

@app.route('/api/sales/<int:sale_id>', methods=['PUT', 'POST'])
def api_update_sale(sale_id):
    data = request.get_json() or {}
    updated_sale = database.update_sale(sale_id, data)
    if not updated_sale:
        return jsonify({"error": "Venta no encontrada o no se pudo actualizar"}), 404
    return jsonify({
        "success": True, 
        "sale": updated_sale, 
        "message": "Venta actualizada y recalculada con éxito"
    })

@app.route('/api/sales/<int:sale_id>/cancel', methods=['POST'])
def api_cancel_sale(sale_id):
    success = database.cancel_sale(sale_id)
    if not success:
        return jsonify({"error": "No se pudo anular la venta o ya estaba anulada"}), 400
    
    # Devolver productos para refrescar stock en frontend
    sale = database.get_sale_detail(sale_id)
    updated_products = [database.get_product(it['product_id']) for it in sale.get('items', [])]
    return jsonify({
        "success": True, 
        "message": "Venta anulada correctamente y stock reintegrado",
        "updated_products": updated_products
    })

@app.route('/api/sales/summary', methods=['GET'])
def api_get_sales_summary():
    date_filter = request.args.get('date', default=None)
    month_filter = request.args.get('month', default=None)
    summary = database.get_sales_summary(date_filter=date_filter, month_filter=month_filter)
    return jsonify({"success": True, "summary": summary})

@app.route('/api/sales/profit-breakdown', methods=['GET'])
def api_get_profit_breakdown():
    period = request.args.get('period', default='today')
    month = request.args.get('month', default=None)
    date = request.args.get('date', default=None)
    breakdown = database.get_profit_breakdown(period=period, month=month, date=date)
    return jsonify({"success": True, "breakdown": breakdown})


# ----------------- INICIALIZACIÓN DE LA APLICACIÓN -----------------

def get_free_port(preferred_port=5000, fallback_ports=(5001, 5050, 8080, 8000, 5500, 3000)):
    """Busca el puerto preferido o uno disponible alternativo si el 5000 está ocupado"""
    for p in (preferred_port, *fallback_ports):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', p))
                return p
        except OSError:
            continue
    # Si ninguno de los preferidos está libre, deja que el sistema operativo asigne uno
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def open_browser(port):
    webbrowser.open_new(f"http://127.0.0.1:{port}")

# Inicializar base de datos al arrancar
database.init_db()

if __name__ == '__main__':
    is_cloud = 'PORT' in os.environ or 'RENDER' in os.environ
    port = int(os.environ.get('PORT', get_free_port()))
    
    if not is_cloud:
        # Abrir navegador automáticamente solo en desarrollo local
        threading.Timer(1.2, lambda: open_browser(port)).start()
        print(f"Iniciando Catálogo de Bebidas en http://127.0.0.1:{port} ...")
        app.run(host='127.0.0.1', port=port, debug=False)
    else:
        print(f"Iniciando Catálogo de Bebidas en producción en puerto {port} ...")
        app.run(host='0.0.0.0', port=port, debug=False)
