import os
import re
import csv
import io
import time
import json
import base64
import random
import sqlite3
import threading
from datetime import datetime

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

import database

import socket
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROME_PROFILE_DIR = os.path.join(
    os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
    'Bebidas25DeMayo_WA_Profile'
)
CHROME_DEBUG_PORT = 9229

def _is_port_open(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            return s.connect_ex(('127.0.0.1', port)) == 0
    except Exception:
        return False

def _find_chrome_exe() -> str:
    candidates = [
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        os.path.join(os.environ.get('LOCALAPPDATA', ''), r'Google\Chrome\Application\chrome.exe')
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return 'chrome.exe'


def init_wa_tables():
    """Crea las tablas para gestionar contactos, plantillas e historial de difusión de WhatsApp."""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wa_contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            chat_title TEXT NOT NULL DEFAULT '',
            tag TEXT NOT NULL DEFAULT 'General',
            active INTEGER NOT NULL DEFAULT 1,
            last_sent_at TEXT DEFAULT NULL,
            last_status TEXT DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_wa_contacts_phone ON wa_contacts(phone)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_wa_contacts_title ON wa_contacts(chat_title)')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wa_templates (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            message_text TEXT NOT NULL,
            image_path TEXT DEFAULT '',
            order_index INTEGER DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute("SELECT COUNT(*) FROM wa_templates")
    if cursor.fetchone()[0] == 0:
        default_templates = [
            (
                "feriado",
                "🔥 Promo Feriado 12 AM",
                "{saludo} 🔥 ¡ESPECIAL FERIADO en Bebidas 25 de Mayo!\nHoy tomamos pedidos HASTA LAS 12 (00:00 hs) 🕛🍾\n\n💥 Mirá algunos de nuestros combos para hoy:\n• Vodka Skyy Cosmic / Saborizado + 3 Speed XL: $18.500\n• Vodka Smirnoff Saborizado + 3 Speed XL: $18.000\n• Ron Malibu 750ml + 2 Baggio 1L: $18.000\n• Fernet Branca 750ml + 2 Coca-Cola 2.5L: $26.500\n• Gin Aconcagua Azul + 2 Tónicas Cunnington 2.25L: $18.500\n• Gin Beefeater 750ml + 2 Tónicas Cunnington 2.25L: $24.000\n• Gancia 950ml + 2 Seven Up 2.25L: $14.500\n• Whisky JW Red Label 750ml + 3 Speed XL: $35.000\n• Pack Coca-Cola 2.5L (x6 botellas): $28.500\n\n💳 ¡Además aprovechá el 20% de REINTEGRO pagando con Cuenta DNI!\n🛵 Envíos SIN CARGO en todo Lanús.\n\n👉 Pedinos respondiendo este mensaje o armá tu carrito en:\nhttps://bebidas25demayo.pages.dev",
                "historia_ig_feriado_pedidos_12am_skyy_cosmic.png",
                1
            ),
            (
                "cuentadni",
                "💳 20% Cuenta DNI",
                "{saludo} 💚 ¡Aprovechá toda la semana el 20% de REINTEGRO pagando con Cuenta DNI en Bebidas 25 de Mayo!\n\n🍾 Combos, packs de gaseosas, cervezas y vinos al mejor precio de Lanús.\n🛵 Envíos SIN CARGO en Lanús.\n\n👇 Mirá todos los precios y armá tu pedido en nuestra web:\nhttps://bebidas25demayo.pages.dev",
                "historia_semana_01_cuenta_dni_medios_pago.png",
                2
            ),
            (
                "mayorista",
                "📦 Clientes / Negocios",
                "{saludo} 📦 Te comparto las promos actualizadas de esta semana en Bebidas 25 de Mayo.\n\n🔥 Pack Coca-Cola 2.5L (6 bot.): $28.500\n💳 Recordá que tenés 20% de reintegro con Cuenta DNI y precios mayoristas llevando desde $100.000.\n\n🛵 Envío sin cargo en Lanús:\nhttps://bebidas25demayo.pages.dev",
                "historia_semana_02_packs_gaseosas.png",
                3
            )
        ]
        for tid, title, text, img, order_i in default_templates:
            cursor.execute(
                "INSERT INTO wa_templates (id, title, message_text, image_path, order_index) VALUES (?, ?, ?, ?, ?)",
                (tid, title, text, img, order_i)
            )

    conn.commit()
    conn.close()


def get_all_templates():
    init_wa_tables()
    conn = database.get_db_connection()
    rows = conn.execute("SELECT id, title, message_text, image_path, order_index FROM wa_templates ORDER BY order_index ASC, id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_or_update_template(template_id: str, title: str, message_text: str, image_path: str = ''):
    init_wa_tables()
    template_id = (template_id or '').strip().lower()
    if not template_id:
        template_id = 'plantilla_' + str(int(time.time()))
    title = (title or 'Plantilla').strip()
    message_text = (message_text or '').strip()
    image_path = (image_path or '').strip()

    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO wa_templates (id, title, message_text, image_path, order_index, updated_at)
        VALUES (?, ?, ?, ?, 99, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            message_text = excluded.message_text,
            image_path = excluded.image_path,
            updated_at = CURRENT_TIMESTAMP
    ''', (template_id, title, message_text, image_path))
    conn.commit()
    conn.close()
    return True


def delete_template(template_id: str):
    init_wa_tables()
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM wa_templates WHERE id = ?", (template_id,))
    conn.commit()
    conn.close()
    return True


def normalize_ar_phone(raw_phone: str) -> str:
    """
    Normaliza números telefónicos argentinos al formato internacional de WhatsApp: 54911XXXXXXXX
    Devuelve '' si no parece un número válido.
    """
    if not raw_phone:
        return ''
    digits = re.sub(r'\D', '', str(raw_phone))
    if not digits or len(digits) < 8:
        return ''

    # Quitar prefijos internacionales 00
    if digits.startswith('00'):
        digits = digits[2:]

    # Si empieza con 549 y tiene 13 dígitos -> ya está listo
    if digits.startswith('549') and len(digits) == 13:
        return digits

    # Si empieza con 54 y tiene 12 dígitos (falta el 9 móvil) -> ej: 541112345678
    if digits.startswith('54') and not digits.startswith('549') and len(digits) == 12:
        return '549' + digits[2:]

    # Si empieza con 5491115... (pusieron el 15 además del 9) -> ej: 549111512345678 (15 dígitos)
    if digits.startswith('5491115') and len(digits) == 15:
        return '54911' + digits[7:]

    # Quitar 0 inicial de código de área nacional (ej: 011 15 1234 5678 o 011 1234 5678)
    if digits.startswith('0'):
        digits = digits[1:]

    # Caso 11 + 15 + 8 dígitos (12 dígitos: 1115XXXXXXXX)
    if digits.startswith('1115') and len(digits) == 12:
        return '54911' + digits[4:]

    # Caso 15 + 8 dígitos (10 dígitos: 15XXXXXXXX -> asumimos AMBA 11)
    if digits.startswith('15') and len(digits) == 10:
        return '54911' + digits[2:]

    # Caso 10 dígitos nacionales (ej: 11XXXXXXXX o código de área + número sin 15)
    if len(digits) == 10:
        return '549' + digits

    # Caso 8 dígitos locales (ej: 45678901 -> asumimos 11 AMBA)
    if len(digits) == 8:
        return '54911' + digits

    # Caso código de área interior con 15 en el medio (ej: 221 15 1234567 -> 12 dígitos)
    m_interior = re.match(r'^(\d{2,4})15(\d{6,8})$', digits)
    if m_interior and len(m_interior.group(1)) + len(m_interior.group(2)) == 10:
        return '549' + m_interior.group(1) + m_interior.group(2)

    # Si tiene entre 11 y 15 dígitos y empieza con otro código de país o 54, devolver tal cual
    if len(digits) >= 11:
        return digits

    return ''


def clean_first_name(full_name: str) -> str:
    """Obtiene un nombre de pila limpio para el saludo personalizado."""
    if not full_name:
        return ''
    # Ignorar si el nombre es un número de teléfono
    if re.sub(r'[\s\+\-\(\)\d]', '', full_name) == '':
        return ''
    # Quitar emojis o símbolos raros al inicio
    cleaned = re.sub(r'[^\w\sáéíóúÁÉÍÓÚñÑüÜ]', ' ', full_name).strip()
    if not cleaned:
        return ''
    ignore_words = {
        'cliente', 'clienta', 'clientes', 'pedido', 'pedidos', 'bebidas', 'kiosco', 'almacen',
        'almacén', 'autoservicio', 'vecino', 'vecina', 'despensa', 'bar', 'evento',
        'celular', 'cel', 'tel', 'whatsapp', 'contacto', 'sin', 'agendar'
    }
    for part in cleaned.split():
        if part.lower() in ignore_words or len(part) < 2 or any(ch.isdigit() for ch in part):
            continue
        return part.capitalize()
    return ''


def get_all_contacts():
    init_wa_tables()
    conn = database.get_db_connection()
    rows = conn.execute('''
        SELECT id, name, phone, chat_title, tag, active, last_sent_at, last_status
        FROM wa_contacts
        ORDER BY active DESC, name ASC, id DESC
    ''').fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_or_update_contact(name='', phone='', chat_title='', tag='General'):
    init_wa_tables()
    norm_phone = normalize_ar_phone(phone)
    name = (name or '').strip()
    chat_title = (chat_title or '').strip()
    tag = (tag or 'General').strip()

    if not norm_phone and not chat_title and not name:
        return False

    conn = database.get_db_connection()
    cursor = conn.cursor()

    existing = None
    if norm_phone:
        existing = cursor.execute('SELECT id, name, chat_title FROM wa_contacts WHERE phone = ?', (norm_phone,)).fetchone()
    if not existing and chat_title:
        existing = cursor.execute('SELECT id, name, phone FROM wa_contacts WHERE LOWER(chat_title) = LOWER(?)', (chat_title,)).fetchone()

    if existing:
        new_name = name if name and not re.match(r'^[\+\d\s\-\(\)]+$', name) else existing['name']
        new_title = chat_title or existing['chat_title']
        if norm_phone:
            cursor.execute('''
                UPDATE wa_contacts SET name = ?, phone = ?, chat_title = ?, tag = ?
                WHERE id = ?
            ''', (new_name, norm_phone, new_title, tag, existing['id']))
        else:
            cursor.execute('''
                UPDATE wa_contacts SET name = ?, chat_title = ?, tag = ?
                WHERE id = ?
            ''', (new_name, new_title, tag, existing['id']))
        conn.commit()
        conn.close()
        return 'updated'
    else:
        display_name = name or chat_title or norm_phone
        cursor.execute('''
            INSERT INTO wa_contacts (name, phone, chat_title, tag, active)
            VALUES (?, ?, ?, ?, 1)
        ''', (display_name, norm_phone, chat_title or display_name, tag))
        conn.commit()
        conn.close()
        return 'inserted'


def import_contacts_from_file(file_bytes: bytes, filename: str, tag: str = 'Google Contacts'):
    """
    Importa contactos desde:
    - Google Contacts CSV / Outlook CSV / CSV genérico
    - Archivo vCard (.vcf) exportado desde Android / iPhone / Google Contacts
    - Archivo .txt con líneas Nombre, Telefono o solo teléfonos
    """
    init_wa_tables()
    ext = os.path.splitext(filename.lower())[1]
    text = ''
    for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
        try:
            text = file_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    inserted = 0
    updated = 0

    if ext == '.vcf' or 'BEGIN:VCARD' in text:
        # Parsear vCard (.vcf)
        cards = re.split(r'BEGIN:VCARD', text, flags=re.IGNORECASE)
        for card in cards:
            if 'END:VCARD' not in card.upper():
                continue
            fn_match = re.search(r'^FN(?:;[^:]*)?:(.*)$', card, flags=re.MULTILINE | re.IGNORECASE)
            name = fn_match.group(1).strip() if fn_match else ''
            # Decodificar Quoted-Printable si el celular exportó en UTF-8 Quoted-Printable
            if 'ENCODING=QUOTED-PRINTABLE' in card.upper() and '=' in name:
                try:
                    import quopri
                    name = quopri.decodestring(name.encode('latin-1')).decode('utf-8', errors='ignore')
                except Exception:
                    pass
            tel_matches = re.findall(r'^TEL(?:;[^:]*)?:(.*)$', card, flags=re.MULTILINE | re.IGNORECASE)
            for raw_tel in tel_matches:
                res = add_or_update_contact(name=name, phone=raw_tel.strip(), chat_title=name, tag=tag)
                if res == 'inserted':
                    inserted += 1
                    break
                elif res == 'updated':
                    updated += 1
                    break
        return {'inserted': inserted, 'updated': updated}

    # Intentar parsear como CSV (Google Contacts CSV / Outlook CSV / CSV simple)
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return {'inserted': 0, 'updated': 0}

    header = [h.strip().lower() for h in rows[0]]
    has_header = any(k in ' '.join(header) for k in ('name', 'nombre', 'phone', 'tel', 'mobile', 'celular', 'given'))

    if has_header:
        name_cols = [i for i, h in enumerate(header) if any(k in h for k in ('name', 'nombre', 'first', 'given', 'family', 'last', 'apellido'))]
        phone_cols = [i for i, h in enumerate(header) if any(k in h for k in ('phone', 'tel', 'mobile', 'celular', 'value', 'numero', 'número'))]

        for row in rows[1:]:
            if not row:
                continue
            # Construir nombre
            name_parts = []
            for idx in name_cols[:3]:
                if idx < len(row) and row[idx].strip():
                    val = row[idx].strip()
                    if val not in name_parts:
                        name_parts.append(val)
            full_name = ' '.join(name_parts).strip()

            # Buscar teléfonos en las columnas de teléfono (o en toda la fila si no se detectaron columnas)
            candidate_cells = [row[idx] for idx in phone_cols if idx < len(row)] if phone_cols else row
            found_phone = ''
            for cell in candidate_cells:
                # Google Contacts a veces separa múltiples teléfonos con " ::: "
                for part in re.split(r':::|;|,', cell):
                    norm = normalize_ar_phone(part)
                    if norm:
                        found_phone = norm
                        break
                if found_phone:
                    break

            if found_phone:
                res = add_or_update_contact(name=full_name or found_phone, phone=found_phone, chat_title=full_name, tag=tag)
                if res == 'inserted':
                    inserted += 1
                elif res == 'updated':
                    updated += 1
    else:
        # Archivo sin encabezado: cada línea puede ser "Nombre, Telefono" o solo "Telefono"
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = re.split(r'[,;\t|]', line)
            if len(parts) >= 2:
                # Ver cuál parte tiene el teléfono
                p0 = normalize_ar_phone(parts[0])
                p1 = normalize_ar_phone(parts[1])
                if p1:
                    res = add_or_update_contact(name=parts[0].strip(), phone=p1, chat_title=parts[0].strip(), tag=tag)
                elif p0:
                    res = add_or_update_contact(name=parts[1].strip(), phone=p0, chat_title=parts[1].strip(), tag=tag)
                else:
                    res = False
            else:
                norm = normalize_ar_phone(line)
                res = add_or_update_contact(name=norm, phone=norm, tag=tag) if norm else False

            if res == 'inserted':
                inserted += 1
            elif res == 'updated':
                updated += 1

    return {'inserted': inserted, 'updated': updated}


# ==============================================================================
# MOTOR SELENIUM DE AUTOMATIZACIÓN DE WHATSAPP WEB
# ==============================================================================

class WhatsAppBroadcasterEngine:
    def __init__(self):
        self.driver = None
        self.lock = threading.Lock()
        self.is_running = False
        self.is_paused = False
        self.stop_requested = False
        self.total_to_send = 0
        self.sent_count = 0
        self.failed_count = 0
        self.current_contact = ''
        self.status_text = 'Listo para conectar WhatsApp Web'
        self.logs = []

    def log(self, msg: str, level: str = 'info'):
        ts = datetime.now().strftime('%H:%M:%S')
        entry = {'time': ts, 'message': msg, 'level': level}
        self.logs.insert(0, entry)
        if len(self.logs) > 250:
            self.logs = self.logs[:250]
        print(f"[WA-BROADCASTER {ts}] {msg}")

    def _attach_to_running_chrome(self) -> bool:
        """Se conecta al Chrome abierto en el puerto CHROME_DEBUG_PORT."""
        if not _is_port_open(CHROME_DEBUG_PORT):
            return False
        try:
            opts = Options()
            opts.add_experimental_option('debuggerAddress', f'127.0.0.1:{CHROME_DEBUG_PORT}')
            self.driver = webdriver.Chrome(options=opts)
            # Asegurar que estemos en la pestaña de WhatsApp Web
            for handle in self.driver.window_handles:
                self.driver.switch_to.window(handle)
                if 'web.whatsapp.com' in (self.driver.current_url or ''):
                    break
            return True
        except Exception:
            self.driver = None
            return False

    def is_browser_alive(self) -> bool:
        if self.driver is not None:
            try:
                _ = self.driver.current_url
                return True
            except Exception:
                self.driver = None
        if _is_port_open(CHROME_DEBUG_PORT):
            return self._attach_to_running_chrome()
        return False

    def check_whatsapp_ready(self) -> dict:
        """Verifica si Chrome está abierto y si WhatsApp Web ya inició sesión."""
        if not self.is_browser_alive():
            return {'browser_open': False, 'logged_in': False, 'state': 'closed'}
        try:
            url = self.driver.current_url or ''
            if 'web.whatsapp.com' not in url:
                return {'browser_open': True, 'logged_in': False, 'state': 'other_url'}
            # Buscar si el panel lateral de chats (#pane-side) o barra de búsqueda está presente
            pane = self.driver.find_elements(By.CSS_SELECTOR, '#pane-side, div[aria-label="Lista de chats"], div[data-tab="3"]')
            if pane:
                return {'browser_open': True, 'logged_in': True, 'state': 'logged_in'}
            # Verificar si el código QR se venció y tiene botón de recargar, y clickearlo automáticamente
            try:
                self.driver.execute_script('''
                    const reloadSpan = document.querySelector('span[data-icon="refresh-large"], span[data-icon="refresh-l-light"]');
                    if (reloadSpan) {
                        const btn = reloadSpan.closest('button, div[role="button"]') || reloadSpan;
                        btn.click();
                    }
                ''')
            except Exception:
                pass
            # Verificar si está mostrando el código QR
            qr = self.driver.find_elements(By.CSS_SELECTOR, 'canvas[aria-label*="Scan"], canvas[aria-label*="Escan"], div[data-ref], canvas')
            if qr:
                return {'browser_open': True, 'logged_in': False, 'state': 'qr_waiting'}
            return {'browser_open': True, 'logged_in': False, 'state': 'loading'}
        except Exception:
            return {'browser_open': False, 'logged_in': False, 'state': 'closed'}

    def get_screenshot_bytes(self):
        """Devuelve una captura PNG en vivo de la pestaña de WhatsApp Web."""
        if not self.is_browser_alive():
            return None
        try:
            return self.driver.get_screenshot_as_png()
        except Exception:
            return None

    def reload_whatsapp_page(self):
        """Recarga la página de WhatsApp Web para refrescar el código QR."""
        if not self.is_browser_alive():
            return self.launch_whatsapp_web()
        try:
            self.driver.get('https://web.whatsapp.com')
            return True, 'Página de WhatsApp Web recargada.'
        except Exception as e:
            return False, str(e)

    def launch_whatsapp_web(self):
        """Abre Google Chrome con perfil persistente fuera de OneDrive en web.whatsapp.com."""
        with self.lock:
            if self.is_browser_alive():
                try:
                    if 'web.whatsapp.com' not in (self.driver.current_url or ''):
                        self.driver.get('https://web.whatsapp.com')
                    self.driver.switch_to.window(self.driver.current_window_handle)
                    self.driver.execute_script('window.focus();')
                    self.log('Ventana de WhatsApp Web activa y conectada.', 'success')
                    return True, 'Ventana de WhatsApp Web conectada.'
                except Exception:
                    self.driver = None

            os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
            chrome_exe = _find_chrome_exe()

            try:
                self.log('Abriendo ventana de Google Chrome para WhatsApp Web...', 'info')
                if not _is_port_open(CHROME_DEBUG_PORT):
                    subprocess.Popen([
                        chrome_exe,
                        f'--user-data-dir={CHROME_PROFILE_DIR}',
                        f'--remote-debugging-port={CHROME_DEBUG_PORT}',
                        '--no-first-run',
                        '--no-default-browser-check',
                        '--start-maximized',
                        'https://web.whatsapp.com'
                    ])
                    for _ in range(20):
                        if _is_port_open(CHROME_DEBUG_PORT):
                            break
                        time.sleep(0.4)

                time.sleep(1.0)
                if self._attach_to_running_chrome():
                    if 'web.whatsapp.com' not in (self.driver.current_url or ''):
                        self.driver.get('https://web.whatsapp.com')
                    self.status_text = 'WhatsApp Web abierto. Escaneá el QR si es la primera vez.'
                    self.log('WhatsApp Web abierto y conectado correctamente.', 'success')
                    return True, 'WhatsApp Web abierto correctamente.'
                else:
                    return False, 'Se abrió Chrome pero no se pudo enlazar el puerto de control.'
            except Exception as e:
                self.log(f'Error al abrir Chrome: {e}', 'error')
                return False, f'Error al abrir Chrome: {e}'

    def scrape_chats_from_whatsapp_web(self, max_scrolls: int = 35):
        """
        Recorre el panel lateral de chats de WhatsApp Web (#pane-side),
        extrae los nombres/números de todos los chats visibles Haciendo scroll gradual,
        y los guarda en wa_contacts.
        """
        state = self.check_whatsapp_ready()
        if not state.get('logged_in'):
            return False, 'Primero debés abrir WhatsApp Web y tener la sesión iniciada.'

        self.log('Extrayendo contactos desde tus chats de WhatsApp Web...', 'info')
        self.status_text = 'Escaneando chats de WhatsApp Web...'

        discovered = {}
        try:
            pane = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '#pane-side'))
            )
            # Ir arriba de todo primero
            self.driver.execute_script('arguments[0].scrollTop = 0;', pane)
            time.sleep(0.8)

            last_scroll_top = -1
            for step in range(max_scrolls):
                # Extraer títulos de los chats visibles en el DOM actual
                items = self.driver.execute_script('''
                    const pane = document.querySelector('#pane-side');
                    if (!pane) return [];
                    const results = [];
                    const rows = pane.querySelectorAll('div[role="listitem"], div[role="row"], div._ak8l, div._ak8q');
                    rows.forEach(r => {
                        const titleEl = r.querySelector('span[title]');
                        if (titleEl) {
                            const title = (titleEl.getAttribute('title') || '').trim();
                            if (title && title.length > 1) {
                                results.push(title);
                            }
                        }
                    });
                    return results;
                ''')
                for title in (items or []):
                    if title not in discovered:
                        discovered[title] = True

                # Scroll hacia abajo
                new_scroll_top = self.driver.execute_script('''
                    const pane = document.querySelector('#pane-side');
                    if (!pane) return 0;
                    pane.scrollTop += 550;
                    return pane.scrollTop;
                ''')
                time.sleep(0.45)
                if new_scroll_top == last_scroll_top:
                    break
                last_scroll_top = new_scroll_top

            # Volver arriba de todo
            self.driver.execute_script('arguments[0].scrollTop = 0;', pane)

            inserted = 0
            updated = 0
            for title in discovered.keys():
                # Ignorar estados / grupos obvios o mensajes propios si aplica
                if title.lower() in ('archivados', 'archived', 'comunidades', 'communities'):
                    continue
                # Ver si el título del chat es directamente un número telefónico (ej: "+54 9 11 1234-5678")
                norm_phone = normalize_ar_phone(title) if re.match(r'^[\+\d\s\-\(\)]+$', title) else ''
                res = add_or_update_contact(
                    name=title,
                    phone=norm_phone,
                    chat_title=title,
                    tag='WhatsApp Web'
                )
                if res == 'inserted':
                    inserted += 1
                elif res == 'updated':
                    updated += 1

            msg = f'Se escanearon {len(discovered)} chats de WhatsApp Web ({inserted} nuevos agregados, {updated} actualizados).'
            self.log(msg, 'success')
            self.status_text = msg
            return True, msg
        except Exception as e:
            err = f'Error al escanear chats de WhatsApp Web: {e}'
            self.log(err, 'error')
            return False, err

    def _sleep_check(self, seconds: float):
        """Pausa reactiva que se interrumpe de inmediato si el usuario presiona Detener."""
        end = time.time() + seconds
        while time.time() < end:
            if self.stop_requested:
                break
            time.sleep(min(0.2, max(0.05, end - time.time())))

    def _ensure_single_whatsapp_tab(self):
        """Asegura que haya una única pestaña activa y enfocada en web.whatsapp.com, cerrando pestañas extra."""
        if not self.driver:
            return
        try:
            handles = self.driver.window_handles
            if len(handles) > 1:
                main_handle = None
                for h in handles:
                    self.driver.switch_to.window(h)
                    if 'web.whatsapp.com' in (self.driver.current_url or ''):
                        main_handle = h
                        break
                if not main_handle:
                    main_handle = handles[0]
                for h in handles:
                    if h != main_handle:
                        try:
                            self.driver.switch_to.window(h)
                            self.driver.close()
                        except Exception:
                            pass
                self.driver.switch_to.window(main_handle)
        except Exception:
            pass

    def _dismiss_open_dialogs(self):
        """Cierra diálogos de error, confirmaciones y cancela modales de imagen colgados."""
        if not self.driver:
            return
        try:
            self.driver.execute_script('''
                // 1. Cerrar diálogos / popups de WhatsApp (ej. número no válido)
                const dialogs = document.querySelectorAll('div[role="dialog"], div[data-animate-modal-popup="true"]');
                for (const d of dialogs) {
                    const btn = d.querySelector('button, div[role="button"]');
                    if (btn) btn.click();
                }
                // 2. Cerrar modal de imagen colgado
                const closeBtn = document.querySelector('div[aria-label="Cerrar"], span[data-icon="x-viewer"], span[data-icon="x"]');
                if (closeBtn) {
                    const b = closeBtn.closest('button, div[role="button"]') || closeBtn;
                    b.click();
                }
            ''')
        except Exception:
            pass

    def _get_search_input(self):
        """Obtiene la caja de búsqueda lateral de WhatsApp Web (#side input o div)."""
        selectors = [
            '#side input[data-tab="3"]',
            '#side input[type="text"]',
            '#side div[contenteditable="true"][data-tab="3"]',
            '#side div[contenteditable="true"]',
            'div[aria-label="Buscar un chat o iniciar uno nuevo"]'
        ]
        for sel in selectors:
            els = self.driver.find_elements(By.CSS_SELECTOR, sel)
            if els:
                return els[0]
        return None

    def _clear_search(self, search_input):
        """Limpia el buscador lateral presionando ESCAPE o borrando el texto."""
        try:
            if search_input:
                search_input.send_keys(Keys.ESCAPE)
                time.sleep(0.15)
                search_input.send_keys(Keys.ESCAPE)
        except Exception:
            pass

    def _open_chat(self, contact: dict) -> bool:
        """
        Abre el chat de forma 100% nativa dentro de WhatsApp Web mediante el buscador interno,
        SIN abrir pestañas nuevas en Chrome, SIN usar enlaces externos y SIN recargar la página.
        """
        if self.stop_requested or not self.driver:
            return False

        self._ensure_single_whatsapp_tab()
        self._dismiss_open_dialogs()

        search_input = self._get_search_input()
        if not search_input:
            self.log('No se encontró el buscador lateral de WhatsApp Web.', 'error')
            return False

        phone = (contact.get('phone') or '').strip()
        chat_title = (contact.get('chat_title') or contact.get('name') or '').strip()

        # Términos a intentar en orden de precisión
        terms_to_try = []
        if phone:
            clean_p = re.sub(r'\D', '', phone)
            terms_to_try.append(clean_p if clean_p else phone)
        if chat_title and chat_title not in terms_to_try:
            terms_to_try.append(chat_title)

        if not terms_to_try:
            return False

        for term in terms_to_try:
            if self.stop_requested:
                return False

            try:
                search_input.click()
                time.sleep(0.15)
                search_input.send_keys(Keys.CONTROL, 'a')
                search_input.send_keys(Keys.BACKSPACE)
                time.sleep(0.1)

                search_input.send_keys(term)

                # Esperar a que WhatsApp filtre los resultados en #pane-side
                found = False
                for _ in range(12):
                    if self.stop_requested:
                        self._clear_search(search_input)
                        return False
                    time.sleep(0.2)

                    res = self.driver.execute_script('''
                        const pane = document.getElementById('pane-side');
                        if (!pane) return 'loading';
                        const txt = (pane.innerText || '').toLowerCase();
                        if (txt.includes('no se encontró') || txt.includes('no chats') || txt.includes('no contacts')) return 'not_found';
                        const rows = pane.querySelectorAll('div[role="listitem"], div[role="row"]');
                        if (rows.length > 0) return 'found';
                        return 'loading';
                    ''')

                    if res == 'found':
                        found = True
                        break
                    elif res == 'not_found':
                        break

                if found:
                    search_input.send_keys(Keys.ENTER)
                    self._sleep_check(0.8)

                    if self._wait_for_chat_box(timeout=5):
                        self._clear_search(search_input)
                        return True

                self._clear_search(search_input)
                self._sleep_check(0.2)

            except Exception as e:
                self.log(f'Error al buscar chat ({term}): {e}', 'error')
                self._clear_search(search_input)

        return False

    def _wait_for_chat_box(self, timeout: int = 6) -> bool:
        """Espera hasta que el cuadro de escritura del chat esté disponible."""
        end_time = time.time() + timeout
        while time.time() < end_time:
            if self.stop_requested:
                return False

            # Verificar si apareció cartel de error o número no válido
            invalid_popup = self.driver.execute_script('''
                const dialogs = document.querySelectorAll('div[data-animate-modal-popup="true"], div[role="dialog"]');
                for (const d of dialogs) {
                    const txt = (d.innerText || '').toLowerCase();
                    if (txt.includes('no es válido') || txt.includes('invalid') || txt.includes('no está en whatsapp')) {
                        const btn = d.querySelector('button, div[role="button"]');
                        if (btn) btn.click();
                        return true;
                    }
                }
                return false;
            ''')
            if invalid_popup:
                return False

            # Verificar si existe la caja de mensaje del chat
            box = self._get_main_message_box()
            if box:
                return True
            time.sleep(0.25)
        return False

    def _get_main_message_box(self):
        selectors = [
            '#main footer div[contenteditable="true"][data-tab="10"]',
            '#main footer div[contenteditable="true"][role="textbox"]',
            '#main footer div[contenteditable="true"]'
        ]
        for sel in selectors:
            els = self.driver.find_elements(By.CSS_SELECTOR, sel)
            if els:
                return els[0]
        return None

    def _paste_text_into_element(self, element, text: str):
        """
        Inserta texto con emojis y saltos de línea dentro de un div[contenteditable="true"] de Lexical/WhatsApp
        usando ClipboardEvent('paste') para evitar errores de BMP con emojis en ChromeDriver.
        """
        self.driver.execute_script('''
            const el = arguments[0];
            const text = arguments[1];
            el.focus();
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            const pasteEvent = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true
            });
            el.dispatchEvent(pasteEvent);
        ''', element, text)

    def _send_image_and_caption(self, image_path: str, caption_text: str) -> bool:
        """
        Adjunta la imagen en el chat activo de WhatsApp Web, escribe el texto como pie de foto
        (o como mensaje si no hay imagen) y presiona Enviar.
        """
        if self.stop_requested:
            return False

        msg_box = self._get_main_message_box()
        if not msg_box:
            return False

        # Caso 1: Solo texto (sin imagen)
        if not image_path or not os.path.exists(image_path):
            try:
                msg_box.click()
                self._sleep_check(0.2)
                self._paste_text_into_element(msg_box, caption_text)
                self._sleep_check(0.5)
                msg_box.send_keys(Keys.ENTER)
                self._sleep_check(1.0)
                return True
            except Exception as e:
                self.log(f'Error enviando texto: {e}', 'error')
                return False

        # Caso 2: Imagen + Texto (Caption)
        try:
            with open(image_path, 'rb') as f:
                b64_data = base64.b64encode(f.read()).decode('ascii')
            ext = os.path.splitext(image_path)[1].lower()
            mime_type = 'image/png' if ext == '.png' else ('image/webp' if ext == '.webp' else 'image/jpeg')
            filename = os.path.basename(image_path)

            msg_box.click()
            self._sleep_check(0.2)

            # Inyectar la imagen mediante ClipboardEvent('paste') directamente sobre el cuadro de chat
            self.driver.execute_script('''
                const el = arguments[0];
                const b64 = arguments[1];
                const mime = arguments[2];
                const fname = arguments[3];

                const byteChars = atob(b64);
                const byteNumbers = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) {
                    byteNumbers[i] = byteChars.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const file = new File([byteArray], fname, { type: mime });

                const dt = new DataTransfer();
                dt.items.add(file);

                el.focus();
                const pasteEvent = new ClipboardEvent('paste', {
                    clipboardData: dt,
                    bubbles: true,
                    cancelable: true
                });
                el.dispatchEvent(pasteEvent);
            ''', msg_box, b64_data, mime_type, filename)

            # Esperar a que se abra el modal de vista previa de la imagen
            modal_ready = False
            for _ in range(25):
                if self.stop_requested:
                    self._dismiss_open_dialogs()
                    return False
                time.sleep(0.3)
                send_btns = self.driver.find_elements(
                    By.CSS_SELECTOR,
                    'div[aria-label="Enviar"], button[aria-label="Enviar"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]'
                )
                caption_boxes = self.driver.execute_script('''
                    const allBoxes = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
                    return allBoxes.filter(b => !b.closest('#main footer') && !b.closest('#side'));
                ''')
                if caption_boxes or len(send_btns) > 0:
                    modal_ready = True
                    break

            if not modal_ready:
                self._dismiss_open_dialogs()
                return False

            self._sleep_check(0.5)

            # 1. Pegar texto en caption_box si existe
            caption_box = self.driver.execute_script('''
                const allBoxes = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
                const modalBoxes = allBoxes.filter(b => !b.closest('#main footer') && !b.closest('#side'));
                return modalBoxes.length > 0 ? modalBoxes[0] : null;
            ''')

            if caption_box and caption_text:
                try:
                    caption_box.click()
                    self._sleep_check(0.2)
                    self._paste_text_into_element(caption_box, caption_text)
                    self._sleep_check(0.5)
                except Exception:
                    pass

            # 2. Hacer click en el botón Enviar verde del modal
            clicked_send = self.driver.execute_script('''
                const sendBtn = document.querySelector('div[aria-label="Enviar"], button[aria-label="Enviar"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]');
                if (sendBtn) {
                    const b = sendBtn.closest('button, div[role="button"]') || sendBtn;
                    b.click();
                    return true;
                }
                return false;
            ''')

            # Fallback con ENTER si no se encontró botón
            if not clicked_send and caption_box:
                caption_box.send_keys(Keys.ENTER)

            # 3. Esperar a que el modal se cierre (confirmando que el mensaje fue enviado)
            modal_closed = False
            for _ in range(25):
                if self.stop_requested:
                    return False
                time.sleep(0.3)
                is_open = self.driver.execute_script('''
                    const modal = document.querySelector('div[data-animate-modal-popup="true"], div[role="dialog"]');
                    return !!modal;
                ''')
                if not is_open:
                    modal_closed = True
                    break

            if not modal_closed:
                # Si el modal sigue abierto, cerrarlo con escape para que no trabe el próximo contacto
                self._dismiss_open_dialogs()
                return False

            return True

        except Exception as e:
            self.log(f'Error en adjunto de imagen: {e}', 'error')
            self._dismiss_open_dialogs()
            return False

    def render_personalized_message(self, template_text: str, contact: dict = None) -> str:
        """
        Reemplaza {saludo} con un saludo por defecto para todos (sin incluir nombres de contacto).
        Varía el saludo aleatoriamente para protección anti-spam de WhatsApp.
        """
        greetings = [
            '¡Hola!',
            '¡Buenas!',
            '¡Hola! ¿Cómo va?',
            '¡Buenas! ¿Todo bien?',
            '¡Hola! ¿Cómo estás?'
        ]
        chosen_greeting = random.choice(greetings)

        msg = template_text or ''
        # Reemplazar combinaciones con {nombre} o {saludo} para que nunca lleven nombre de contacto
        msg = msg.replace('{saludo} {nombre}!', chosen_greeting)
        msg = msg.replace('{saludo} {nombre}', chosen_greeting)
        msg = msg.replace('{saludo}!', chosen_greeting)
        msg = msg.replace('{saludo}', chosen_greeting)
        msg = msg.replace('{nombre}!', '')
        msg = msg.replace('{nombre}', '')

        # Limpiar posibles espacios dobles que queden
        msg = re.sub(r'[ \t]+', ' ', msg)
        return msg.strip()

    def start_campaign(self, contact_ids: list, message_template: str, image_path: str, min_delay: int = 14, max_delay: int = 24):
        if self.is_running:
            return False, 'Ya hay una campaña de difusión en ejecución.'

        state = self.check_whatsapp_ready()
        if not state.get('logged_in'):
            return False, 'Primero abrí WhatsApp Web con el botón "1. Abrir WhatsApp Web" y verificá que tu sesión esté iniciada.'

        init_wa_tables()
        conn = database.get_db_connection()
        if contact_ids:
            placeholders = ','.join(['?'] * len(contact_ids))
            rows = conn.execute(f'SELECT * FROM wa_contacts WHERE id IN ({placeholders})', contact_ids).fetchall()
        else:
            rows = conn.execute('SELECT * FROM wa_contacts WHERE active = 1').fetchall()
        conn.close()

        contacts = [dict(r) for r in rows]
        if not contacts:
            return False, 'No hay contactos seleccionados para enviar.'

        self.is_running = True
        self.is_paused = False
        self.stop_requested = False
        self.total_to_send = len(contacts)
        self.sent_count = 0
        self.failed_count = 0

        thread = threading.Thread(
            target=self._campaign_worker,
            args=(contacts, message_template, image_path, max(6, int(min_delay)), max(8, int(max_delay))),
            daemon=True
        )
        thread.start()
        return True, f'Campaña iniciada para {len(contacts)} contactos.'

    def _campaign_worker(self, contacts: list, message_template: str, image_path: str, min_delay: int, max_delay: int):
        self.log(f'🚀 Iniciando difusión automática a {len(contacts)} contactos...', 'info')
        for idx, contact in enumerate(contacts, start=1):
            if self.stop_requested:
                self.log('🛑 Difusión detenida por el usuario.', 'warning')
                self.status_text = 'Difusión detenida.'
                break

            while self.is_paused and not self.stop_requested:
                self.status_text = '⏸️ Difusión en pausa...'
                time.sleep(1.0)

            display = contact.get('name') or contact.get('chat_title') or contact.get('phone') or f"Contacto #{contact['id']}"
            phone = (contact.get('phone') or '').strip()
            chat_title = (contact.get('chat_title') or contact.get('name') or '').strip()

            self.current_contact = f"{display} ({idx}/{len(contacts)})"
            self.status_text = f"Enviando a {display} ({idx} de {len(contacts)})..."
            self.log(f"[{idx}/{len(contacts)}] Abriendo chat con {display}...", 'info')

            opened = self._open_chat(contact)

            now_str = datetime.now().strftime('%d/%m/%Y %H:%M')
            conn = database.get_db_connection()

            if not opened:
                self.failed_count += 1
                self.log(f"⚠️ No se pudo abrir el chat de {display}. Saltando...", 'warning')
                conn.execute('UPDATE wa_contacts SET last_sent_at = ?, last_status = ? WHERE id = ?', (now_str, 'error', contact['id']))
                conn.commit()
                conn.close()
                continue

            personalized_msg = self.render_personalized_message(message_template, contact)
            sent_ok = self._send_image_and_caption(image_path, personalized_msg)

            if sent_ok:
                self.sent_count += 1
                self.log(f"✅ Enviado con éxito a {display}", 'success')
                conn.execute('UPDATE wa_contacts SET last_sent_at = ?, last_status = ? WHERE id = ?', (now_str, 'ok', contact['id']))
            else:
                self.failed_count += 1
                self.log(f"❌ Error al adjuntar/enviar mensaje a {display}", 'error')
                conn.execute('UPDATE wa_contacts SET last_sent_at = ?, last_status = ? WHERE id = ?', (now_str, 'error', contact['id']))

            conn.commit()
            conn.close()

            # Pausa aleatoria anti-bloqueo antes del siguiente contacto
            if idx < len(contacts) and not self.stop_requested:
                wait_secs = random.randint(min(min_delay, max_delay), max(min_delay, max_delay))
                for remaining in range(wait_secs, 0, -1):
                    if self.stop_requested:
                        break
                    self.status_text = f"⏳ Pausa anti-bloqueo: próximo envío en {remaining}s ({self.sent_count}/{len(contacts)} enviados)"
                    time.sleep(1.0)

        self.is_running = False
        self.current_contact = ''
        if self.stop_requested:
            self.status_text = f"🛑 Difusión detenida. Se enviaron {self.sent_count} de {len(contacts)} mensajes."
            self.log(self.status_text, 'warning')
        else:
            self.status_text = f"🎉 ¡Difusión completada! {self.sent_count} enviados, {self.failed_count} fallidos."
            self.log(self.status_text, 'success')


broadcaster_engine = WhatsAppBroadcasterEngine()

