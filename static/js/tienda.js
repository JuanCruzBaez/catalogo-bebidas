/**
 * BEBIDAS 25 DE MAYO - LÓGICA DE TIENDA Y PEDIDOS PARA CLIENTES
 * Manejo reactivo de catálogo seguro, combos, carrusel, carrito y checkout
 */

(function () {
    'use strict';

    // Estado global de la aplicación cliente
    const state = {
        config: {
            business_name: 'BEBIDAS 25 DE MAYO',
            whatsapp_phone: '5491176265350',
            email: 'bebidas.25demayo@hotmail.com',
            wholesale_threshold: 100000
        },
        products: [],
        combos: [],
        categories: [],
        cart: [],
        activeCategory: 'all',
        searchQuery: '',
        sortBy: 'featured',
        carouselIndex: 0,
        carouselTimer: null
    };

    // Utilidad para formatear moneda en Pesos Argentinos ($ 26.000)
    function formatCurrency(amount) {
        if (isNaN(amount)) return '$ 0';
        return '$ ' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    // Toast de notificación
    function showToast(message, icon = 'fa-check') {
        const toast = document.getElementById('toastNotification');
        if (!toast) return;
        toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
        toast.classList.add('show');
        clearTimeout(toast.hideTimeout);
        toast.hideTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 2600);
    }

    // ----------------- GESTIÓN DEL CARRITO (LOCALSTORAGE) -----------------
    function loadCartFromStorage() {
        try {
            const saved = localStorage.getItem('b25_client_cart');
            state.cart = saved ? JSON.parse(saved) : [];
        } catch (e) {
            state.cart = [];
        }
        updateCartUI();
    }

    function saveCartToStorage() {
        try {
            localStorage.setItem('b25_client_cart', JSON.stringify(state.cart));
        } catch (e) {
            console.error('Error al guardar carrito:', e);
        }
        updateCartUI();
    }

    function addToCart(item) {
        const existing = state.cart.find(it => it.id === item.id && it.type === item.type);
        if (existing) {
            existing.qty += (item.qty || 1);
        } else {
            state.cart.push({
                id: item.id,
                type: item.type || 'product',
                name: item.name,
                presentation: item.presentation || '',
                price: parseFloat(item.price) || 0,
                qty: parseInt(item.qty || 1, 10),
                image: item.image || ''
            });
        }
        saveCartToStorage();
        showToast(`Se agregó ${item.name} al carrito`);
    }

    function updateCartQty(index, change) {
        if (!state.cart[index]) return;
        state.cart[index].qty += change;
        if (state.cart[index].qty <= 0) {
            state.cart.splice(index, 1);
        }
        saveCartToStorage();
    }

    function removeFromCart(index) {
        if (!state.cart[index]) return;
        const name = state.cart[index].name;
        state.cart.splice(index, 1);
        saveCartToStorage();
        showToast(`Se eliminó ${name} del carrito`, 'fa-trash');
    }

    function updateCartUI() {
        const totalItems = state.cart.reduce((sum, it) => sum + it.qty, 0);
        const subtotal = state.cart.reduce((sum, it) => sum + (it.price * it.qty), 0);

        // Actualizar badges e indicadores
        const countBadge = document.getElementById('cartCountBadge');
        const headerTotal = document.getElementById('cartTotalHeader');
        const drawerCount = document.getElementById('cartDrawerCount');
        const floatingCount = document.getElementById('floatingCartCount');
        const cartSubtotalEl = document.getElementById('cartSubtotal');
        const cartTotalEl = document.getElementById('cartTotal');
        const wholesaleNotice = document.getElementById('wholesaleNoticeBox');

        if (countBadge) countBadge.textContent = totalItems;
        if (headerTotal) headerTotal.textContent = formatCurrency(subtotal);
        if (drawerCount) drawerCount.textContent = totalItems;
        if (floatingCount) floatingCount.textContent = totalItems;
        if (cartSubtotalEl) cartSubtotalEl.textContent = formatCurrency(subtotal);
        if (cartTotalEl) cartTotalEl.textContent = formatCurrency(subtotal);

        // Aviso mayorista si califica
        if (wholesaleNotice) {
            if (subtotal >= state.config.wholesale_threshold) {
                wholesaleNotice.style.display = 'flex';
            } else {
                wholesaleNotice.style.display = 'none';
            }
        }

        // Renderizar lista en el drawer
        const container = document.getElementById('cartItemsContainer');
        if (!container) return;

        if (state.cart.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px 10px;">
                    <i class="fa-solid fa-cart-arrow-down empty-icon"></i>
                    <h3>Tu carrito está vacío</h3>
                    <p>Elegí tus bebidas o combos favoritos para armar tu pedido.</p>
                </div>
            `;
            return;
        }

        let html = '';
        state.cart.forEach((it, idx) => {
            const isCombo = it.type === 'combo';
            const imgPath = it.image ? `/${it.image}` : '/uploads/logo.jpg';

            html += `
                <div class="cart-item">
                    <div class="cart-item-img">
                        <img src="${imgPath}" onerror="this.src='/uploads/logo.jpg'" alt="${it.name}">
                    </div>
                    <div class="cart-item-info">
                        <div class="cart-item-name" title="${it.name}">
                            ${isCombo ? '<span style="color: var(--brand-gold);">[COMBO]</span> ' : ''}${it.name}
                        </div>
                        <div class="cart-item-sub">${it.presentation || (isCombo ? 'Bebida + Acompañante' : '')}</div>
                        <div class="cart-item-price">${formatCurrency(it.price * it.qty)} (${formatCurrency(it.price)} c/u)</div>
                    </div>
                    <div class="cart-item-stepper">
                        <button onclick="tiendaApp.updateQty(${idx}, -1)" aria-label="Restar una unidad">-</button>
                        <span>${it.qty}</span>
                        <button onclick="tiendaApp.updateQty(${idx}, 1)" aria-label="Sumar una unidad">+</button>
                    </div>
                    <button class="btn-remove-item" onclick="tiendaApp.removeItem(${idx})" title="Quitar producto">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    function openCart() {
        const drawer = document.getElementById('cartDrawer');
        const backdrop = document.getElementById('cartBackdrop');
        if (drawer && backdrop) {
            drawer.classList.add('open');
            backdrop.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCart() {
        const drawer = document.getElementById('cartDrawer');
        const backdrop = document.getElementById('cartBackdrop');
        if (drawer && backdrop) {
            drawer.classList.remove('open');
            backdrop.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
    }

    // ----------------- CARRUSEL HERO AUTOMÁTICO -----------------
    function initCarousel() {
        const slides = document.querySelectorAll('.carousel-slide');
        const dotsContainer = document.getElementById('carouselDots');
        const prevBtn = document.getElementById('carouselPrevBtn');
        const nextBtn = document.getElementById('carouselNextBtn');
        const track = document.getElementById('carouselTrack');

        if (!slides.length || !dotsContainer) return;

        // Crear dots
        dotsContainer.innerHTML = '';
        slides.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
            dot.addEventListener('click', () => goToSlide(idx));
            dotsContainer.appendChild(dot);
        });

        function goToSlide(index) {
            slides.forEach((s, idx) => {
                s.classList.toggle('active', idx === index);
            });
            const dots = dotsContainer.querySelectorAll('.carousel-dot');
            dots.forEach((d, idx) => {
                d.classList.toggle('active', idx === index);
            });
            state.carouselIndex = index;
        }

        function nextSlide() {
            const nextIdx = (state.carouselIndex + 1) % slides.length;
            goToSlide(nextIdx);
        }

        function prevSlide() {
            const prevIdx = (state.carouselIndex - 1 + slides.length) % slides.length;
            goToSlide(prevIdx);
        }

        if (nextBtn) nextBtn.addEventListener('click', nextSlide);
        if (prevBtn) prevBtn.addEventListener('click', prevSlide);

        // Auto avance cada 5.5 segundos
        function startTimer() {
            stopTimer();
            state.carouselTimer = setInterval(nextSlide, 5500);
        }

        function stopTimer() {
            if (state.carouselTimer) clearInterval(state.carouselTimer);
        }

        startTimer();

        // Pausa al pasar el mouse por encima
        if (track) {
            track.addEventListener('mouseenter', stopTimer);
            track.addEventListener('mouseleave', startTimer);
        }
    }

    // ----------------- RENDERIZADO DE COMBOS -----------------
    function renderCombos() {
        const grid = document.getElementById('combosGrid');
        if (!grid) return;

        if (state.combos.length === 0) {
            grid.innerHTML = '<p class="empty-state">No hay combos disponibles en este momento.</p>';
            return;
        }

        let html = '';
        state.combos.forEach(c => {
            const imgPath = c.image_path ? `/${c.image_path}` : '/uploads/logo.jpg';
            const itemsList = (c.items || []).map(it => `<li><i class="fa-solid fa-check"></i> ${it.qty}x ${it.name}</li>`).join('');

            html += `
                <div class="combo-card">
                    ${c.badge ? `<span class="combo-badge-pill">${c.badge}</span>` : ''}
                    <div class="combo-image-box">
                        <img src="${imgPath}" onerror="this.src='/uploads/logo.jpg'" alt="${c.name}">
                    </div>
                    <div class="combo-content">
                        <h3 class="combo-name">${c.name}</h3>
                        ${c.description ? `<p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 8px;">${c.description}</p>` : ''}
                        <ul class="combo-items-list">
                            ${itemsList}
                        </ul>
                        <div class="combo-price-row">
                            <span class="combo-price">${formatCurrency(c.price)}</span>
                            ${c.regular_price > c.price ? `<span class="combo-regular-price">Antes: ${formatCurrency(c.regular_price)}</span>` : ''}
                        </div>
                        <button class="btn-add-combo" onclick="tiendaApp.addComboById(${c.id})">
                            <i class="fa-solid fa-cart-plus"></i> Agregar Combo
                        </button>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
    }

    // ----------------- RENDERIZADO DE CATEGORÍAS -----------------
    function renderCategories() {
        const container = document.getElementById('categoryPills');
        if (!container) return;

        let html = `
            <button class="pill-btn ${state.activeCategory === 'all' ? 'active' : ''}" data-category="all">
                <i class="fa-solid fa-layer-group"></i> Todos los Productos
            </button>
            <button class="pill-btn ${state.activeCategory === 'combos' ? 'active' : ''}" data-category="combos">
                <i class="fa-solid fa-fire"></i> Combos Especiales
            </button>
        `;

        state.categories.forEach(cat => {
            const isActive = state.activeCategory === String(cat.id);
            html += `
                <button class="pill-btn ${isActive ? 'active' : ''}" data-category="${cat.id}">
                    ${cat.icon ? `<i class="${cat.icon}"></i>` : '<i class="fa-solid fa-wine-glass"></i>'}
                    ${cat.name} (${cat.product_count})
                </button>
            `;
        });

        container.innerHTML = html;

        // Event listeners en pastillas
        container.querySelectorAll('.pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const cat = btn.getAttribute('data-category');
                filterByCategory(cat);
            });
        });
    }

    function filterByCategory(category) {
        state.activeCategory = category;

        // Si elige combos, hacer scroll suave a la sección de combos
        if (category === 'combos' || category === 'Combos') {
            const combosEl = document.getElementById('combosSection');
            if (combosEl) {
                combosEl.scrollIntoView({ behavior: 'smooth' });
            }
        } else {
            // Scroll a productos
            const catBar = document.getElementById('catalogSection');
            if (catBar) {
                catBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        renderFilteredProducts();
    }

    // ----------------- RENDERIZADO DE PRODUCTOS -----------------
    function renderFilteredProducts() {
        const grid = document.getElementById('productsGrid');
        const emptyState = document.getElementById('noResultsState');
        const resultsCountEl = document.getElementById('resultsCountText');
        const filterBadge = document.getElementById('activeFilterBadge');

        if (!grid) return;

        let filtered = [...state.products];

        // Filtro de categoría
        if (state.activeCategory !== 'all' && state.activeCategory !== 'combos') {
            filtered = filtered.filter(p => String(p.category_id) === String(state.activeCategory));
            const catObj = state.categories.find(c => String(c.id) === String(state.activeCategory));
            if (catObj && filterBadge) {
                filterBadge.textContent = catObj.name;
                filterBadge.style.display = 'inline-block';
            }
        } else {
            if (filterBadge) filterBadge.style.display = 'none';
        }

        // Filtro de búsqueda
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase().trim();
            filtered = filtered.filter(p => 
                p.name.toLowerCase().includes(q) ||
                (p.presentation && p.presentation.toLowerCase().includes(q)) ||
                (p.category_name && p.category_name.toLowerCase().includes(q))
            );
        }

        // Ordenamiento
        if (state.sortBy === 'price-asc') {
            filtered.sort((a, b) => a.price_minorista - b.price_minorista);
        } else if (state.sortBy === 'price-desc') {
            filtered.sort((a, b) => b.price_minorista - a.price_minorista);
        } else if (state.sortBy === 'name-asc') {
            filtered.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            // Destacados primero
            filtered.sort((a, b) => (b.is_featured || 0) - (a.is_featured || 0));
        }

        // Actualizar contador
        if (resultsCountEl) {
            resultsCountEl.textContent = `${filtered.length} producto${filtered.length === 1 ? '' : 's'} disponible${filtered.length === 1 ? '' : 's'}`;
        }

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        let html = '';
        filtered.forEach(p => {
            const imgPath = p.image_path ? `/${p.image_path}` : '/uploads/logo.jpg';
            
            // Lógica de badges seguros (sin filtrar stock exacto a menos que sea crítico)
            let stockBadge = '';
            if (p.is_out_of_stock) {
                stockBadge = '<span class="out-of-stock-badge">Agotado</span>';
            } else if (p.is_low_stock && p.low_stock_count) {
                const text = p.low_stock_count === 1 ? '¡Última unidad!' : `¡Últimas ${p.low_stock_count} unidades!`;
                stockBadge = `<span class="low-stock-badge"><i class="fa-solid fa-fire"></i> ${text}</span>`;
            }

            const featuredBadge = p.is_featured ? '<span class="featured-badge">⭐ Destacado</span>' : '';

            html += `
                <div class="product-card" data-product-id="${p.id}">
                    ${stockBadge}
                    ${featuredBadge}
                    <div class="product-image-container">
                        <img src="${imgPath}" onerror="this.src='/uploads/logo.jpg'" alt="${p.name}" loading="lazy">
                    </div>
                    <div class="product-info">
                        <span class="product-category-tag">${p.category_name}</span>
                        <h3 class="product-name" title="${p.name}">${p.name}</h3>
                        <div class="product-presentation">${p.presentation || 'Unidad'}</div>
                        
                        <div class="product-pricing-box">
                            <div class="product-price-minorista">${formatCurrency(p.price_minorista)}</div>
                            <div class="product-price-mayorista">Mayor: ${formatCurrency(p.price_mayorista)} <span style="font-size: 10px; color: #94a3b8;">(> $100k)</span></div>
                        </div>

                        <div class="product-actions">
                            <div class="quantity-stepper">
                                <button onclick="tiendaApp.decrementCardQty(${p.id})" aria-label="Restar">-</button>
                                <input type="number" id="qty-input-${p.id}" value="1" min="1" max="99" readonly>
                                <button onclick="tiendaApp.incrementCardQty(${p.id})" aria-label="Sumar">+</button>
                            </div>
                            <button 
                                class="btn-add-cart" 
                                onclick="tiendaApp.addProductById(${p.id})"
                                ${p.is_out_of_stock ? 'disabled' : ''}>
                                <i class="fa-solid fa-cart-plus"></i> ${p.is_out_of_stock ? 'Agotado' : 'Pedir'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
    }

    // ----------------- CHECKOUT WHATSAPP & EMAIL -----------------
    function validateCheckout() {
        if (state.cart.length === 0) {
            alert('Tu carrito de compras está vacío. Por favor agrega productos.');
            return null;
        }

        const name = (document.getElementById('customerName')?.value || '').trim();
        const phone = (document.getElementById('customerPhone')?.value || '').trim();
        const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value || 'delivery';
        const address = (document.getElementById('customerAddress')?.value || '').trim();
        const payment = document.getElementById('paymentMethod')?.value || 'Efectivo';
        const notes = (document.getElementById('orderNotes')?.value || '').trim();

        if (!name) {
            alert('Por favor ingresa tu Nombre y Apellido para el pedido.');
            document.getElementById('customerName')?.focus();
            return null;
        }

        if (!phone) {
            alert('Por favor ingresa tu número de Teléfono o WhatsApp.');
            document.getElementById('customerPhone')?.focus();
            return null;
        }

        if (deliveryType === 'delivery' && !address) {
            alert('Por favor ingresa tu Dirección de Entrega (calle, número y entrecalles).');
            document.getElementById('customerAddress')?.focus();
            return null;
        }

        return {
            name,
            phone,
            deliveryType: deliveryType === 'delivery' ? 'Envío a Domicilio (Lanús)' : 'Retiro en Local (Av. 25 de Mayo 434)',
            address: deliveryType === 'delivery' ? address : 'Retira en local por Lanús Oeste',
            payment,
            notes
        };
    }

    function buildOrderSummaryText(customer) {
        const subtotal = state.cart.reduce((sum, it) => sum + (it.price * it.qty), 0);
        const isWholesaleQualified = subtotal >= state.config.wholesale_threshold;

        let itemsText = '';
        state.cart.forEach((it, idx) => {
            const prefix = it.type === 'combo' ? '🔥 [COMBO] ' : '• ';
            const pres = it.presentation ? ` (${it.presentation})` : '';
            itemsText += `${prefix}${it.qty}x ${it.name}${pres} — ${formatCurrency(it.price * it.qty)}\n`;
        });

        let msg = `🛒 *NUEVO PEDIDO - BEBIDAS 25 DE MAYO*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `👤 *Cliente:* ${customer.name}\n`;
        msg += `📞 *Teléfono:* ${customer.phone}\n`;
        msg += `🛵 *Modalidad:* ${customer.deliveryType}\n`;
        if (customer.address && customer.deliveryType.includes('Envío')) {
            msg += `📍 *Dirección:* ${customer.address}\n`;
        }
        msg += `💳 *Medio de Pago:* ${customer.payment}\n`;
        if (customer.notes) {
            msg += `📝 *Aclaraciones:* ${customer.notes}\n`;
        }
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📦 *DETALLE DEL PEDIDO:*\n${itemsText}`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💰 *TOTAL ESTIMADO: ${formatCurrency(subtotal)}*\n`;
        
        if (isWholesaleQualified) {
            msg += `⭐ *¡Califica para precio mayorista por superar los $100.000!* (Coordinar descuento final).\n`;
        }
        
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `¡Hola Bebidas 25 de Mayo! Envío mi pedido realizado desde la página web. Aguardo su confirmación. ¡Muchas gracias!`;

        return msg;
    }

    function sendWhatsappOrder() {
        const customer = validateCheckout();
        if (!customer) return;

        const summaryText = buildOrderSummaryText(customer);
        const encoded = encodeURIComponent(summaryText);
        const phone = state.config.whatsapp_phone || '5491176265350';
        const url = `https://wa.me/${phone}?text=${encoded}`;

        window.open(url, '_blank');
    }

    function sendEmailOrder() {
        const customer = validateCheckout();
        if (!customer) return;

        const subtotal = state.cart.reduce((sum, it) => sum + (it.price * it.qty), 0);
        const summaryText = buildOrderSummaryText(customer);
        const email = state.config.email || 'bebidas.25demayo@hotmail.com';
        const subject = encodeURIComponent(`Nuevo Pedido Web - ${customer.name} (${formatCurrency(subtotal)})`);
        const body = encodeURIComponent(summaryText);
        const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;

        window.location.href = mailtoUrl;
    }

    // ----------------- EVENT LISTENERS Y CONFIGURACIÓN -----------------
    function setupEventListeners() {
        // Carrito drawer
        const openCartBtn = document.getElementById('openCartBtn');
        const floatingCartBtn = document.getElementById('floatingCartBtn');
        const closeCartBtn = document.getElementById('closeCartBtn');
        const cartBackdrop = document.getElementById('cartBackdrop');

        if (openCartBtn) openCartBtn.addEventListener('click', openCart);
        if (floatingCartBtn) floatingCartBtn.addEventListener('click', openCart);
        if (closeCartBtn) closeCartBtn.addEventListener('click', closeCart);
        if (cartBackdrop) cartBackdrop.addEventListener('click', closeCart);

        // Búsqueda
        const searchInput = document.getElementById('searchInput');
        const clearSearchBtn = document.getElementById('clearSearchBtn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.searchQuery = e.target.value;
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
                }
                renderFilteredProducts();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                state.searchQuery = '';
                clearSearchBtn.style.display = 'none';
                renderFilteredProducts();
            });
        }

        // Ordenamiento
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                state.sortBy = e.target.value;
                renderFilteredProducts();
            });
        }

        // Tipo de entrega (Envío vs Retiro)
        const deliveryRadios = document.querySelectorAll('input[name="deliveryType"]');
        const addressGroup = document.getElementById('addressFieldGroup');
        deliveryRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (addressGroup) {
                    addressGroup.style.display = e.target.value === 'delivery' ? 'block' : 'none';
                }
            });
        });

        // Botones de Checkout
        const btnWhatsapp = document.getElementById('sendWhatsappOrderBtn');
        const btnEmail = document.getElementById('sendEmailOrderBtn');

        if (btnWhatsapp) btnWhatsapp.addEventListener('click', sendWhatsappOrder);
        if (btnEmail) btnEmail.addEventListener('click', sendEmailOrder);
    }

    // ----------------- CARGA DE DATOS INICIAL -----------------
    async function initApp() {
        setupEventListeners();
        loadCartFromStorage();

        try {
            // 1. Cargar Configuración pública
            const confRes = await fetch('/api/public/info');
            if (confRes.ok) {
                state.config = await confRes.json();
            }

            // 2. Cargar Combos
            const combosRes = await fetch('/api/public/combos');
            if (combosRes.ok) {
                state.combos = await combosRes.json();
                renderCombos();
            }

            // 3. Cargar Categorías
            const catsRes = await fetch('/api/public/categories');
            if (catsRes.ok) {
                state.categories = await catsRes.json();
                renderCategories();
            }

            // 4. Cargar Productos públicos seguros
            const prodsRes = await fetch('/api/public/products');
            if (prodsRes.ok) {
                state.products = await prodsRes.json();
                renderFilteredProducts();
            }

            // 5. Iniciar Carrusel
            initCarousel();

        } catch (err) {
            console.error('Error cargando catálogo público:', err);
            showToast('Error de conexión al cargar el catálogo', 'fa-triangle-exclamation');
        }
    }

    // Exponer métodos para interacción directa en HTML (onclick)
    window.tiendaApp = {
        addProductById: function (id) {
            const prod = state.products.find(p => p.id === id);
            if (!prod) return;
            const qtyInput = document.getElementById(`qty-input-${id}`);
            const qty = qtyInput ? parseInt(qtyInput.value, 10) || 1 : 1;
            addToCart({
                id: prod.id,
                type: 'product',
                name: prod.name,
                presentation: prod.presentation,
                price: prod.price_minorista,
                qty: qty,
                image: prod.image_path
            });
        },
        addComboById: function (id) {
            const combo = state.combos.find(c => c.id === id);
            if (!combo) return;
            addToCart({
                id: combo.id,
                type: 'combo',
                name: combo.name,
                presentation: combo.description,
                price: combo.price,
                qty: 1,
                image: combo.image_path
            });
        },
        incrementCardQty: function (id) {
            const input = document.getElementById(`qty-input-${id}`);
            if (input) {
                let val = parseInt(input.value, 10) || 1;
                if (val < 99) input.value = val + 1;
            }
        },
        decrementCardQty: function (id) {
            const input = document.getElementById(`qty-input-${id}`);
            if (input) {
                let val = parseInt(input.value, 10) || 1;
                if (val > 1) input.value = val - 1;
            }
        },
        updateQty: function (index, change) {
            updateCartQty(index, change);
        },
        removeItem: function (index) {
            removeFromCart(index);
        },
        filterByCategory: function (cat) {
            filterByCategory(cat);
        },
        resetFilters: function () {
            state.activeCategory = 'all';
            state.searchQuery = '';
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.style.display = 'none';
            renderCategories();
            renderFilteredProducts();
        }
    };

    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
