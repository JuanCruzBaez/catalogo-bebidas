import os
import io
import math
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, KeepTogether, PageBreak
)
from reportlab.pdfgen import canvas
from database import get_all_settings, get_categories, get_products

def format_price(amount, symbol="$"):
    if amount is None or amount == "":
        return f"{symbol} 0"
    try:
        val = float(amount)
        if val.is_integer():
            formatted = f"{int(val):,}".replace(",", ".")
        else:
            formatted = f"{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return f"{symbol} {formatted}"
    except (ValueError, TypeError):
        return f"{symbol} {amount}"

def hex_to_rl_color(hex_str, default=colors.black):
    if not hex_str:
        return default
    hex_clean = hex_str.strip().lstrip("#")
    if len(hex_clean) == 6:
        try:
            r = int(hex_clean[0:2], 16) / 255.0
            g = int(hex_clean[2:4], 16) / 255.0
            b = int(hex_clean[4:6], 16) / 255.0
            return colors.Color(r, g, b)
        except ValueError:
            return default
    return default

def draw_black_first_page_background(canvas_obj, doc_obj):
    """Dibuja el fondo negro profundo en la portada"""
    page_w, page_h = A4
    canvas_obj.saveState()
    canvas_obj.setFillColor(colors.HexColor("#000000"))
    canvas_obj.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    canvas_obj.restoreState()

def draw_black_catalog_background(canvas_obj, doc_obj):
    """Dibuja el fondo negro y la paginación dorada a partir de la página 3"""
    page_w, page_h = A4
    canvas_obj.saveState()
    canvas_obj.setFillColor(colors.HexColor("#000000"))
    canvas_obj.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    
    # Número de página en dorado en la esquina inferior derecha a partir de la página 3
    page_num = canvas_obj._pageNumber
    if page_num >= 3:
        canvas_obj.setFont("Helvetica-Bold", 9.5)
        canvas_obj.setFillColor(colors.HexColor("#F5C518"))
        canvas_obj.drawRightString(page_w - 8*mm, 5*mm, f"Pág. {page_num}")
        
    canvas_obj.restoreState()

def get_product_image_dimensions(prod):
    """
    Calcula dimensiones proporcionales realistas según el tipo y volumen del producto:
    - Botellas gigantes / bidones (6L, 5L, 3L, 2.25L, 2L, 1.75L, 1.5L): Max altura 38.5mm, ancho hasta 30mm.
    - Botellas estándar / licores / vinos / whiskies (1L, 750ml, 710ml, 700ml): Altura intermedia 34mm, ancho 25mm.
    - Latas / porrones / botellitas medianas (500ml, 473ml): Altura compacta 27.5mm, ancho 21mm.
    - Latas chicas / snacks / alfajores (354ml, 330ml, 269ml, alfajores, cono, galletitas): Altura menor 23mm, ancho 23mm.
    """
    name = (prod.get('name') or '').upper()
    pres = (prod.get('presentation') or '').upper()
    cat = (prod.get('category_name') or '').upper()
    
    # 1. Bidones y botellas grandes (gaseosas grandes, aguas de 6L, etc.)
    if any(k in pres for k in ['6L', '5L', '3L', '2.25', '2,25', '2.5', '2L', '1.75', '1.5']):
        return 30 * mm, 38.5 * mm
        
    # 2. Snacks, alfajores, chocolates, galletitas
    if any(k in cat for k in ['SNACK', 'ALFAJOR', 'GOLOSINA', 'COMESTIBLE']) or any(k in name for k in ['ALFAJOR', 'CONO', 'BATATA', 'PAPAS', 'GALLETIT']):
        return 26 * mm, 24 * mm

    # 3. Latas pequeñas y medianas
    if any(k in pres for k in ['269', '310', '330', '350', '354', '355']):
        return 20 * mm, 24 * mm
    if any(k in pres for k in ['473', '500']) or 'LATA' in name:
        return 22 * mm, 27.5 * mm

    # 4. Botellas medianas / estándar (vinos, espumantes, whiskies, aperitivos 700ml, 750ml, 1L, etc.)
    if any(k in pres for k in ['700', '710', '750', '900', '1L', '1 L', '1000']):
        return 24 * mm, 34 * mm

    # Por defecto
    return 26 * mm, 32 * mm

def generate_visual_catalog_pdf(catalog_type="minorista", output_stream=None):
    """
    Genera el Catálogo Visual Profesional (Minorista o Combinado con Precios Mayoristas):
    - Fondo: Negro puro (#000000).
    - 12 productos por página (2 columnas x 6 filas) con imágenes proporcionales al volumen real.
    - PÁGINA 1: Portada principal con logo, nombre y ficha completa de la empresa.
    - PÁGINA 2: Índice de categorías enumeradas (1 al N) con enlaces interactivos cliqueables para saltar directamente a la sección.
    - PÁGINA 3 EN ADELANTE: Grilla homogénea de 12 productos por página con fotos escaladas, precios claros y estado 'AGOTADO' si stock <= 0.
    """
    settings = get_all_settings()

    c_card_bg = colors.white
    c_primary = hex_to_rl_color(settings.get("primary_color", "#B81414")) # Rojo institucional
    c_gold = hex_to_rl_color(settings.get("category_header_color", "#F5C518"))
    c_dark = colors.HexColor("#121212")
    c_out_stock = colors.HexColor("#DC2626") # Rojo alerta agotado

    biz_name = settings.get("business_name", "BEBIDAS 25 DE MAYO")
    if catalog_type == "combinado":
        subtitle = "Catálogo Oficial · Minorista y Mayorista"
    else:
        subtitle = settings.get("header_subtitle_minorista", "Catálogo de Productos · Minorista")
    banner_phrase = settings.get("banner_phrase", "PARA TU NEGOCIO Y PARA VOS")
    disclaimer = settings.get("disclaimer", "Precios sujetos a modificación sin previo aviso. Las imágenes son de carácter ilustrativo. Consulte disponibilidad y condiciones comerciales.")
    
    whatsapp_num = settings.get("whatsapp_number", "+54 9 11 2525-2525")
    instagram = settings.get("instagram", "@bebidas25demayo")
    address = settings.get("address", "Av. 25 de Mayo 1234, Buenos Aires")
    hours = settings.get("cover_business_hours", "Lunes a Sábados de 10:00 a 22:00 hs")
    delivery = settings.get("cover_delivery_info", "Envíos a domicilio y entregas en el día · Consultar zonas de cobertura")
    logo_path = settings.get("logo_path", "uploads/logo.jpg")
    currency = settings.get("currency_symbol", "$")

    today_str = datetime.now().strftime("%d/%m/%Y")

    page_w, page_h = A4
    margin_x = 7 * mm
    margin_y = 6 * mm
    content_w = page_w - (2 * margin_x)

    if output_stream is None:
        output_stream = io.BytesIO()

    doc = SimpleDocTemplate(
        output_stream,
        pagesize=A4,
        leftMargin=margin_x,
        rightMargin=margin_x,
        topMargin=margin_y,
        bottomMargin=margin_y
    )

    # 1. Obtener categorías activas y calcular páginas de inicio (12 productos por página)
    categories = get_categories()
    active_categories_data = []
    current_catalog_page = 3 # Empieza en página 3
    
    for cat in categories:
        prods = get_products(category_id=cat["id"], active_only=True)
        if prods:
            pages_for_cat = math.ceil(len(prods) / 12.0)
            active_categories_data.append({
                "category": cat,
                "products": prods,
                "start_page": current_catalog_page,
                "pages_count": pages_for_cat
            })
            current_catalog_page += pages_for_cat

    story = []

    # =========================================================================
    # PÁGINA 1: PORTADA PRINCIPAL DE LA EMPRESA
    # =========================================================================
    story.append(Spacer(1, 14*mm))

    # Logo Centrado
    if logo_path and os.path.exists(logo_path):
        try:
            logo_cover = RLImage(logo_path, width=72*mm, height=72*mm, kind='proportional')
            story.append(logo_cover)
        except Exception:
            pass

    story.append(Spacer(1, 7*mm))

    # Título Principal y Subtítulo
    title_p = Paragraph(f"""
        <font size="25" color="#FFFFFF"><b>{biz_name}</b></font><br/>
        <font size="12" color="#F5C518"><b>{subtitle.upper()}</b></font>
    """, ParagraphStyle('CoverTitle', alignment=1, leading=27))
    story.append(title_p)

    story.append(Spacer(1, 4*mm))

    # Banner Rojo Frase
    if banner_phrase:
        banner_cover_p = Paragraph(
            f'<font size="10.5" color="white"><b>— {banner_phrase.upper()} —</b></font>',
            ParagraphStyle('CoverBanner', alignment=1, leading=13)
        )
        banner_cover_t = Table([[banner_cover_p]], colWidths=[content_w * 0.88])
        banner_cover_t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), c_primary),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(banner_cover_t)

    story.append(Spacer(1, 3*mm))

    # Fecha de actualización
    date_p = Paragraph(f'<font size="8.5" color="#94A3B8">Actualizado al {today_str}</font>', ParagraphStyle('CoverDate', alignment=1, leading=11))
    story.append(date_p)

    story.append(Spacer(1, 9*mm))

    # Tarjeta de Información y Contacto
    contact_rows = [
        [Paragraph(f'<font size="11.5" color="#F5C518"><b>INFORMACIÓN Y PEDIDOS</b></font>', ParagraphStyle('CHead', alignment=1, leading=14))],
        [Spacer(1, 2*mm)],
        [Paragraph(f'<font size="9.5" color="white"><b>📱 WhatsApp de Pedidos:</b> {whatsapp_num}</font>', ParagraphStyle('CItem', leading=14))],
        [Paragraph(f'<font size="9.5" color="white"><b>📸 Instagram:</b> {instagram}</font>', ParagraphStyle('CItem', leading=14))],
        [Paragraph(f'<font size="9.5" color="white"><b>📍 Local / Dirección:</b> {address}</font>', ParagraphStyle('CItem', leading=14))],
        [Paragraph(f'<font size="9.5" color="white"><b>⏰ Horarios de Atención:</b> {hours}</font>', ParagraphStyle('CItem', leading=14))],
        [Paragraph(f'<font size="9.5" color="white"><b>🚚 Envíos:</b> {delivery}</font>', ParagraphStyle('CItem', leading=14))]
    ]
    if catalog_type == "combinado":
        contact_rows.append([Paragraph(f'<font size="9.5" color="#F5C518"><b>📦 Venta Mayorista:</b> Precios especiales por bulto a partir de $100.000</font>', ParagraphStyle('CItem', leading=14))])

    contact_box = Table(contact_rows, colWidths=[content_w * 0.88])
    contact_box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#0D0D0D")),
        ('BOX', (0, 0), (-1, -1), 1.5, colors.HexColor("#F5C518")),
        ('LEFTPADDING', (0, 0), (-1, -1), 16),
        ('RIGHTPADDING', (0, 0), (-1, -1), 16),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
    ]))
    story.append(contact_box)
    story.append(PageBreak())

    # =========================================================================
    # PÁGINA 2: ÍNDICE DE CATEGORÍAS ENUMERADO (1 A N) CON ENLACES INTERACTIVOS
    # =========================================================================
    story.append(Spacer(1, 8*mm))

    # Badge 'CATEGORÍAS' Dorado
    badge_idx_p = Paragraph(f'<font size="13" color="#111111"><b>CATEGORÍAS</b></font>', ParagraphStyle('IdxBadge', alignment=1, leading=15))
    badge_idx_t = Table([[badge_idx_p]], colWidths=[52*mm])
    badge_idx_t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), c_gold),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(badge_idx_t)
    story.append(Spacer(1, 2.5*mm))

    sub_idx_p = Paragraph(f'<font size="8.5" color="#94A3B8">Toca cualquier categoría para ir directamente a sus productos</font>', ParagraphStyle('IdxSub', alignment=1, leading=11))
    story.append(sub_idx_p)
    story.append(Spacer(1, 6*mm))

    # Filas del índice elegantes con numeración 1..N y enlaces interactivos
    idx_rows = []
    num_cats = len(active_categories_data)
    idx_font_size = 10 if num_cats <= 13 else (9 if num_cats <= 16 else 8.5)
    idx_leading = 14 if num_cats <= 13 else (12.5 if num_cats <= 16 else 11.5)
    idx_pad = 3.5 if num_cats <= 13 else (2.5 if num_cats <= 16 else 2)

    style_idx_name = ParagraphStyle('IdxName', fontName='Helvetica-Bold', fontSize=idx_font_size, leading=idx_leading, textColor=colors.white)
    style_idx_num = ParagraphStyle('IdxNum', fontName='Helvetica-Bold', fontSize=idx_font_size, leading=idx_leading, alignment=2, textColor=colors.HexColor("#F5C518"))

    for cat_num, cat_entry in enumerate(active_categories_data, 1):
        c_name = cat_entry["category"]["name"].upper()
        c_page = str(cat_entry["start_page"])
        cat_anchor = f"cat_sec_{cat_entry['category']['id']}"
        
        link_name_p = Paragraph(
            f'<a href="#{cat_anchor}" color="#FFFFFF"><b>{cat_num}. {c_name}</b></a>',
            style_idx_name
        )
        link_num_p = Paragraph(
            f'<a href="#{cat_anchor}" color="#F5C518"><b>Pág. {c_page} ➔</b></a>',
            style_idx_num
        )
        idx_rows.append([link_name_p, link_num_p])

    idx_table_w = content_w * 0.84
    idx_table = Table(idx_rows, colWidths=[idx_table_w * 0.78, idx_table_w * 0.22])
    idx_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), idx_pad),
        ('BOTTOMPADDING', (0, 0), (-1, -1), idx_pad),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, colors.HexColor("#222222")),
    ]))
    story.append(idx_table)
    story.append(PageBreak())

    # =========================================================================
    # PÁGINA 3 EN ADELANTE: CATÁLOGO VISUAL - 12 PRODUCTOS (IMÁGENES GRANDES Y UNIFORMES)
    # =========================================================================
    card_gap = 2.5 * mm
    card_w = (content_w - card_gap) / 2
    row_height = 43.5 * mm # Altura homogénea para 6 filas por página

    for cat_entry in active_categories_data:
        cat = cat_entry["category"]
        prods = cat_entry["products"]
        cat_anchor = f"cat_sec_{cat['id']}"

        chunk_size = 12
        for chunk_idx in range(0, len(prods), chunk_size):
            chunk = prods[chunk_idx:chunk_idx + chunk_size]
            is_first_page_of_cat = (chunk_idx == 0)

            # 1. Cabecera de la página
            logo_w = None
            if logo_path and os.path.exists(logo_path):
                try:
                    logo_w = RLImage(logo_path, width=28*mm, height=11*mm, kind='proportional')
                except Exception:
                    logo_w = None

            head_center = Paragraph(f"""
                <font size="12" color="white"><b>{biz_name}</b></font><br/>
                <font size="7" color="#94A3B8">Actualizado al {today_str}</font>
            """, ParagraphStyle('VHeadCenter', alignment=1, leading=10))

            # Si es la primera página de la categoría, insertamos el marcador de destino interactivo
            if is_first_page_of_cat:
                cat_badge_p = Paragraph(f"""
                    <a name="{cat_anchor}"/><font size="9.5" color="#111111"><b>{cat['name'].upper()}</b></font>
                """, ParagraphStyle('VCatBadge', alignment=1, leading=10))
            else:
                cat_badge_p = Paragraph(f"""
                    <font size="9.5" color="#111111"><b>{cat['name'].upper()}</b></font>
                """, ParagraphStyle('VCatBadge', alignment=1, leading=10))

            badge_t = Table([[cat_badge_p]], colWidths=[42*mm])
            badge_t.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), c_gold),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 2.5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
            ]))

            if logo_w:
                head_widths = [30*mm, content_w - 76*mm, 46*mm]
                head_t = Table([[logo_w, head_center, badge_t]], colWidths=head_widths)
            else:
                head_widths = [content_w - 46*mm, 46*mm]
                head_t = Table([[head_center, badge_t]], colWidths=head_widths)

            head_t.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
                ('LINEBELOW', (0, 0), (-1, -1), 1, colors.HexColor("#F5C518")),
            ]))
            story.append(head_t)
            story.append(Spacer(1, 1.5*mm))

            # 2. Grilla de 12 Tarjetas (2 columnas x 6 filas) con imágenes ampliadas
            cards = []

            for prod in chunk:
                is_out_of_stock = (prod.get("stock", 10) <= 0)
                
                p_name = prod["name"]
                p_pres = prod.get("presentation", "").strip()

                # Imagen del producto con dimensionamiento proporcional al volumen real
                prod_img_path = prod.get("image_path")
                img_w = None
                if prod_img_path and os.path.exists(prod_img_path):
                    try:
                        p_w_dim, p_h_dim = get_product_image_dimensions(prod)
                        img_w = RLImage(prod_img_path, width=p_w_dim, height=p_h_dim, kind='proportional')
                    except Exception:
                        img_w = None

                if not img_w:
                    img_w = Paragraph(f"""
                        <font size="24" color="#CBD5E1">🍾</font><br/>
                        <font size="6" color="#94A3B8">Sin foto</font>
                    """, ParagraphStyle('NoImgM', alignment=1, leading=8))

                # Bloque de Título y Presentación
                title_html = f"<font size='8.5' color='#0F172A'><b>{p_name}</b></font>"
                if p_pres:
                    title_html += f"<br/><font size='7.5' color='#475569'>{p_pres}</font>"
                title_p = Paragraph(title_html, ParagraphStyle('CardTitleM', leading=10))

                # Bloque de Precios / Estado de Stock
                if is_out_of_stock:
                    # Badge AGOTADO
                    badge_agotado = Paragraph(f"<font size='8.5' color='white'><b>● AGOTADO</b></font>", ParagraphStyle('AgotadoBadge', alignment=1, leading=9.5))
                    status_t = Table([[badge_agotado]], colWidths=[card_w * 0.54])
                    status_t.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, -1), c_out_stock),
                        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                        ('TOPPADDING', (0, 0), (-1, -1), 3),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                    ]))
                    right_content = [title_p, Spacer(1, 2*mm), status_t]
                elif catalog_type == "combinado":
                    # Precios Combinados: Minorista y Mayorista claramente diferenciados
                    price_min_val = format_price(prod["price_minorista"], currency)
                    price_may_val = format_price(prod["price_mayorista"], currency)

                    min_label = Paragraph("<font size='6' color='#64748B'><b>MENOR</b></font>", ParagraphStyle('DMinL', leading=7))
                    min_num = Paragraph(f"<font size='8.5' color='#1E293B'><b>{price_min_val}</b></font>", ParagraphStyle('DMinN', alignment=2, leading=9))

                    may_label = Paragraph("<font size='6' color='#B45309'><b>MAYOR</b></font>", ParagraphStyle('DMayL', leading=7))
                    may_num = Paragraph(f"<font size='10' color='#B81414'><b>{price_may_val}</b></font>", ParagraphStyle('DMayN', alignment=2, leading=10.5))

                    dual_box = Table([
                        [min_label, min_num],
                        [may_label, may_num]
                    ], colWidths=[card_w * 0.22, card_w * 0.32])
                    dual_box.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
                        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor("#FEF3C7")),
                        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
                        ('LINEBELOW', (0, 0), (-1, 0), 0.5, colors.HexColor("#E2E8F0")),
                        ('TOPPADDING', (0, 0), (-1, -1), 1.5),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
                        ('LEFTPADDING', (0, 0), (-1, -1), 3),
                        ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ]))
                    right_content = [title_p, Spacer(1, 1*mm), dual_box]
                else:
                    # Precio Minorista individual
                    price_val = format_price(prod["price_minorista"], currency)
                    price_badge_p = Paragraph(f"<font size='6.5' color='#94A3B8'><b>PRECIO</b></font>", ParagraphStyle('PBadgeM', alignment=1, leading=7.5))
                    price_num_p = Paragraph(f"<font size='11.5' color='#B81414'><b>{price_val}</b></font>", ParagraphStyle('PNumM', alignment=1, leading=12.5))
                    
                    price_box_t = Table([[price_badge_p], [price_num_p]], colWidths=[card_w * 0.52])
                    price_box_t.setStyle(TableStyle([
                        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#E2E8F0")),
                        ('TOPPADDING', (0, 0), (-1, -1), 1.5),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ]))
                    right_content = [title_p, Spacer(1, 1.5*mm), price_box_t]

                card_inner = Table([[img_w, right_content]], colWidths=[card_w * 0.42, card_w * 0.56], rowHeights=[row_height - 2*mm])
                card_inner.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), c_card_bg),
                    ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('ALIGN', (0, 0), (0, 0), 'CENTER'),
                    ('TOPPADDING', (0, 0), (-1, -1), 1.5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 1.5),
                    ('LEFTPADDING', (0, 0), (-1, -1), 2),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                ]))
                cards.append(card_inner)

            # Rellenar hasta 12 si la página tiene menos productos
            while len(cards) < 12:
                empty_t = Table([[Paragraph("", ParagraphStyle('E'))]], colWidths=[card_w], rowHeights=[row_height - 2*mm])
                empty_t.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), colors.transparent),
                ]))
                cards.append(empty_t)

            grid_data = [
                [cards[0], cards[1]],
                [cards[2], cards[3]],
                [cards[4], cards[5]],
                [cards[6], cards[7]],
                [cards[8], cards[9]],
                [cards[10], cards[11]],
            ]
            grid_table = Table(grid_data, colWidths=[card_w, card_w], rowHeights=[row_height]*6)
            grid_table.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 1),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
                ('LEFTPADDING', (0, 0), (-1, -1), 1),
                ('RIGHTPADDING', (0, 0), (-1, -1), 1),
            ]))
            story.append(grid_table)
            story.append(Spacer(1, 1.5*mm))

            # 3. Pie de página
            foot_p = Paragraph(f"""
                <font size="5.8" color="#64748B">{disclaimer}</font>
            """, ParagraphStyle('PageFootM', alignment=1, leading=7))
            foot_table = Table([[foot_p]], colWidths=[content_w * 0.88])
            story.append(foot_table)

            story.append(PageBreak())

    if story and isinstance(story[-1], PageBreak):
        story.pop()

    doc.build(
        story,
        onFirstPage=draw_black_first_page_background,
        onLaterPages=draw_black_catalog_background
    )

    if hasattr(output_stream, 'getvalue'):
        return output_stream.getvalue()
    return None

def generate_minorista_visual_pdf(output_stream=None):
    return generate_visual_catalog_pdf(catalog_type="minorista", output_stream=output_stream)

def generate_combinado_visual_pdf(output_stream=None):
    return generate_visual_catalog_pdf(catalog_type="combinado", output_stream=output_stream)

def draw_mayorista_decorations(canvas_obj, doc_obj):
    """Agrega pie de página y número de página a cada hoja del catálogo mayorista"""
    page_w, page_h = A4
    canvas_obj.saveState()
    page_num = canvas_obj._pageNumber
    canvas_obj.setFont("Helvetica-Bold", 8)
    canvas_obj.setFillColor(colors.HexColor("#64748B"))
    canvas_obj.drawString(10*mm, 6*mm, "BEBIDAS 25 DE MAYO · Catálogo de Precios Mayoristas")
    canvas_obj.setFillColor(colors.HexColor("#B81414"))
    canvas_obj.drawRightString(page_w - 10*mm, 6*mm, f"Página {page_num}")
    canvas_obj.restoreState()

def generate_list_pdf(catalog_type="mayorista", output_stream=None):
    """
    Genera el PDF con el diseño visual institucional 'BEBIDAS 25 DE MAYO':
    - Cabecera negra con logo circular, nombre de fantasía y subtítulo.
    - Banner rojo institucional 'PARA TU NEGOCIO Y PARA VOS'.
    - Encabezados de categorías en dorado/amarillo con contador de productos.
    - Fila de subtítulos de columnas: DESCRIPCIÓN DEL PRODUCTO y PRECIO MAYORISTA.
    - Filas de productos con tipografía destacada, fondo alternado y precios en rojo a la derecha.
    - Si stock <= 0, muestra '[AGOTADO]' junto al precio.
    - Disclaimer legal y pie de página negro con WhatsApp y datos de contacto.
    """
    settings = get_all_settings()
    
    c_primary = hex_to_rl_color(settings.get("primary_color", "#B81414"))
    c_gold = hex_to_rl_color(settings.get("category_header_color", "#F5C518"))
    c_dark = colors.HexColor("#0D0D0D")
    c_bg_alt = colors.HexColor("#F8FAFC")
    c_line = colors.HexColor("#E2E8F0")

    biz_name = settings.get("business_name", "BEBIDAS 25 DE MAYO")
    if catalog_type == "mayorista":
        subtitle = settings.get("header_subtitle_mayorista", "Catálogo de Precios · Mayorista")
    else:
        subtitle = settings.get("header_subtitle_minorista", "Catálogo de Precios · Minorista")
        
    banner_phrase = settings.get("banner_phrase", "PARA TU NEGOCIO Y PARA VOS")
    disclaimer = settings.get("disclaimer", "Precios sujetos a modificación sin previo aviso · Consultá disponibilidad y descuentos por cantidad.")
    footer_title = settings.get("footer_text", "BEBIDAS 25 DE MAYO — MAYORISTA Y MINORISTA")
    whatsapp_num = settings.get("whatsapp_number", "+54 9 11 2525-2525")
    instagram = settings.get("instagram", "@bebidas25demayo")
    address = settings.get("address", "Av. 25 de Mayo 1234, Buenos Aires")
    currency = settings.get("currency_symbol", "$")
    logo_path = settings.get("logo_path", "uploads/logo.jpg")

    today_str = datetime.now().strftime("%d/%m/%Y")

    page_w, page_h = A4
    margin_x = 10 * mm
    top_margin = 8 * mm
    bottom_margin = 12 * mm
    content_w = page_w - (2 * margin_x)

    if output_stream is None:
        output_stream = io.BytesIO()

    doc = SimpleDocTemplate(
        output_stream,
        pagesize=A4,
        leftMargin=margin_x,
        rightMargin=margin_x,
        topMargin=top_margin,
        bottomMargin=bottom_margin
    )

    story = []

    # 1. HEADER INSTITUCIONAL ELEGANTE
    logo_widget = None
    if logo_path and os.path.exists(logo_path):
        try:
            logo_widget = RLImage(logo_path, width=38*mm, height=14*mm, kind='proportional')
        except Exception:
            logo_widget = None

    header_text_p = Paragraph(f"""
        <font size="15" color="white"><b>{biz_name}</b></font><br/>
        <font size="8.5" color="#F5C518"><b>{subtitle.upper()}</b></font>
    """, ParagraphStyle('HeadText', leading=13))

    date_badge_p = Paragraph(f"""
        <font size="7.5" color="#94A3B8">LISTA VIGENTE AL</font><br/>
        <font size="9" color="#FFFFFF"><b>{today_str}</b></font>
    """, ParagraphStyle('DateBadge', alignment=2, leading=10.5))

    if logo_widget:
        header_data = [[logo_widget, header_text_p, date_badge_p]]
        col_w = [42*mm, content_w - 78*mm, 36*mm]
    else:
        header_data = [[header_text_p, date_badge_p]]
        col_w = [content_w - 40*mm, 40*mm]

    header_table = Table(header_data, colWidths=col_w)
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), c_dark),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(header_table)

    # 2. BANNER ROJO
    if banner_phrase.strip():
        banner_p = Paragraph(
            f'<font size="8.5" color="white"><b>— {banner_phrase.strip().upper()} —</b></font>',
            ParagraphStyle('BannerText', alignment=1, leading=10)
        )
        banner_table = Table([[banner_p]], colWidths=[content_w])
        banner_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), c_primary),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(banner_table)

    story.append(Spacer(1, 3*mm))

    # 3. CATEGORÍAS Y PRODUCTOS
    categories = get_categories()

    style_cat_title = ParagraphStyle('CatTitle', fontName='Helvetica-Bold', fontSize=10, leading=12, textColor=colors.HexColor("#111111"))
    style_cat_count = ParagraphStyle('CatCount', fontName='Helvetica-Bold', fontSize=8, leading=12, alignment=2, textColor=colors.HexColor("#333333"))

    style_prod_name = ParagraphStyle('ProdName', fontName='Helvetica-Bold', fontSize=9, leading=11, textColor=colors.HexColor("#0F172A"))
    style_prod_price = ParagraphStyle('ProdPrice', fontName='Helvetica-Bold', fontSize=10, leading=12, alignment=2, textColor=colors.HexColor("#B81414"))

    for cat in categories:
        prods = get_products(category_id=cat["id"], active_only=True)
        if not prods:
            continue

        cat_elements = []

        # Barra de Categoría Dorada
        cat_p_left = Paragraph(f"◆ {cat['name'].upper()}", style_cat_title)
        cat_p_right = Paragraph(f"{len(prods)} productos", style_cat_count)
        cat_header_t = Table([[cat_p_left, cat_p_right]], colWidths=[content_w * 0.75, content_w * 0.25])
        cat_header_t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), c_gold),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        cat_elements.append(cat_header_t)

        # Filas de Productos
        prod_rows = []
        for idx, prod in enumerate(prods):
            p_name = prod["name"].strip()
            p_pres = prod.get("presentation", "").strip()

            title_html = f"<font color='#0F172A'><b>{p_name}</b></font>"
            if p_pres:
                title_html += f" &nbsp;<font color='#64748B' size='8'>({p_pres})</font>"

            price_val = prod["price_mayorista"] if catalog_type == "mayorista" else prod["price_minorista"]
            formatted_p = format_price(price_val, currency)

            if prod.get("stock", 10) <= 0:
                price_html = f"<font color='#DC2626' size='7.5'><b>[AGOTADO]</b></font> &nbsp;<font color='#94A3B8'>{formatted_p}</font>"
            else:
                price_html = f"<font color='#B81414'><b>{formatted_p}</b></font>"

            p_col_name = Paragraph(title_html, style_prod_name)
            p_col_price = Paragraph(price_html, style_prod_price)
            prod_rows.append([p_col_name, p_col_price])

        col_w_name = content_w * 0.74
        col_w_price = content_w * 0.26
        prod_table = Table(prod_rows, colWidths=[col_w_name, col_w_price])
        
        t_style = [
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 2.6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2.6),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('LINEBELOW', (0, 0), (-1, -1), 0.5, c_line),
        ]
        for row_idx in range(len(prod_rows)):
            if row_idx % 2 == 1:
                t_style.append(('BACKGROUND', (0, row_idx), (-1, row_idx), c_bg_alt))
            else:
                t_style.append(('BACKGROUND', (0, row_idx), (-1, row_idx), colors.white))

        prod_table.setStyle(TableStyle(t_style))
        cat_elements.append(prod_table)
        cat_elements.append(Spacer(1, 3.5*mm))

        story.append(KeepTogether(cat_elements[:3]))
        if len(cat_elements) > 3:
            for el in cat_elements[3:]:
                story.append(el)

    # 4. PIE DE PÁGINA FINAL
    story.append(Spacer(1, 3*mm))
    if disclaimer.strip():
        disc_p = Paragraph(
            f'<font size="6.5" color="#64748B">{disclaimer.strip()}</font>',
            ParagraphStyle('DiscText', alignment=1, leading=8)
        )
        story.append(disc_p)
        story.append(Spacer(1, 2.5*mm))

    contact_parts = []
    if footer_title:
        contact_parts.append(f'<font size="8.5" color="#F5C518"><b>{footer_title}</b></font>')
    
    sub_contact = []
    if whatsapp_num:
        sub_contact.append(f"📱 Pedidos WhatsApp: {whatsapp_num}")
    if instagram:
        sub_contact.append(f"📸 Instagram: {instagram}")
    if address:
        sub_contact.append(f"📍 {address}")

    if sub_contact:
        contact_parts.append(f'<font size="7.5" color="white">{"  ·  ".join(sub_contact)}</font>')

    footer_p = Paragraph("<br/>".join(contact_parts), ParagraphStyle('FooterText', alignment=1, leading=11))
    footer_table = Table([[footer_p]], colWidths=[content_w])
    footer_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), c_dark),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(footer_table)

    doc.build(
        story,
        onFirstPage=draw_mayorista_decorations,
        onLaterPages=draw_mayorista_decorations
    )
    
    if hasattr(output_stream, 'getvalue'):
        return output_stream.getvalue()
    return None

def generate_pdf(catalog_type="minorista", output_stream=None):
    """
    Punto de entrada principal:
    - Minorista: Catálogo Visual con fotos en grilla de 12 productos por página y precio minorista.
    - Combinado: Catálogo Visual con fotos en grilla de 12 productos y doble precio (Mayorista + Minorista).
    - Mayorista: Catálogo de Lista Oficial '25 de Mayo' con precios mayoristas.
    """
    if catalog_type == "combinado":
        return generate_combinado_visual_pdf(output_stream)
    elif catalog_type == "minorista":
        return generate_minorista_visual_pdf(output_stream)
    else:
        return generate_list_pdf("mayorista", output_stream)
