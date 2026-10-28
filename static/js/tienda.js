/**
 * BEBIDAS 25 DE MAYO - LÓGICA DE TIENDA Y PEDIDOS PARA CLIENTES
 * Modo Claro Comercial + Menú Hamburguesa de Categorías + Barra Progreso Mayorista
 * + Switch Minorista/Mayorista + Indicador en Tarjetas + Botones Rápidos Flotantes
 */

(function () {
    'use strict';

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
        priceMode: 'minorista', // 'minorista' | 'mayorista'
        searchQuery: '',
        sortBy: 'featured',
        carouselIndex: 0,
        carouselTimer: null
    };

    function formatCurrency(amount) {
        if (isNaN(amount)) return '$ 0';
        return '$ ' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

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

    // ----------------- CÁLCULO DE TOTALES Y MAYORISTA AUTOMÁTICO -----------------
    function getCartTotals() {
        let retailSubtotal = 0;
        let wholesaleSubtotal = 0;
        let totalItems = 0;

        state.cart.forEach(it => {
            const qty = parseInt(it.qty || 1, 10);
            totalItems += qty;
            if (it.type === 'combo') {
                const p = parseFloat(it.price) || 0;
                retailSubtotal += p * qty;
                wholesaleSubtotal += p * qty;
            } else {
                const prod = state.products.find(p => String(p.id) === String(it.id));
                const pMin = prod ? (parseFloat(prod.price_minorista) || 0) : (parseFloat(it.priceMinorista || it.price) || 0);
                const pMay = prod ? (parseFloat(prod.price_mayorista) || pMin) : (parseFloat(it.priceMayorista || it.price) || pMin);
                retailSubtotal += pMin * qty;
                wholesaleSubtotal += pMay * qty;
            }
        });

        const threshold = state.config.wholesale_threshold || 100000;
        const qualifiesWholesale = retailSubtotal >= threshold;
        const effectiveTotal = qualifiesWholesale ? wholesaleSubtotal : retailSubtotal;
        const savings = qualifiesWholesale ? Math.max(0, retailSubtotal - wholesaleSubtotal) : 0;
        const remainingForWholesale = Math.max(0, threshold - retailSubtotal);
        const progressPct = Math.min(100, Math.round((retailSubtotal / threshold) * 100));

        return {
            totalItems,
            retailSubtotal,
            wholesaleSubtotal,
            qualifiesWholesale,
            effectiveTotal,
            savings,
            remainingForWholesale,
            progressPct,
            threshold
        };
    }

    function getCartQtyForItem(id, type = 'product') {
        const found = state.cart.find(it => String(it.id) === String(id) && it.type === type);
        return found ? found.qty : 0;
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
        renderFilteredProducts();
        renderCombos();
    }

    function addToCart(item) {
        const existing = state.cart.find(it => String(it.id) === String(item.id) && it.type === item.type);
        if (existing) {
            existing.qty += (item.qty || 1);
            if (item.priceMinorista) existing.priceMinorista = item.priceMinorista;
            if (item.priceMayorista) existing.priceMayorista = item.priceMayorista;
        } else {
            state.cart.push({
                id: item.id,
                type: item.type || 'product',
                name: item.name,
                presentation: item.presentation || '',
                price: parseFloat(item.price) || 0,
                priceMinorista: parseFloat(item.priceMinorista || item.price) || 0,
                priceMayorista: parseFloat(item.priceMayorista || item.price) || 0,
                qty: parseInt(item.qty || 1, 10),
                image: item.image || ''
            });
        }
        saveCartToStorage();
        showToast(`Se agregó ${item.name} al pedido`);
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
        showToast(`Se quitó ${name} del pedido`, 'fa-trash');
    }

    function updateCartUI() {
        const totals = getCartTotals();

        const countBadge = document.getElementById('cartCountBadge');
        const headerTotal = document.getElementById('cartTotalHeader');
        const drawerCount = document.getElementById('cartDrawerCount');
        const floatingCount = document.getElementById('floatingCartCount');
        const cartSubtotalEl = document.getElementById('cartSubtotal');
        const cartTotalEl = document.getElementById('cartTotal');
        const wholesaleNotice = document.getElementById('wholesaleNoticeBox');
        const cartSavingsRow = document.getElementById('cartSavingsRow');
        const cartSavingsAmount = document.getElementById('cartSavingsAmount');

        // Barra de progreso mayorista en el carrito
        const progressText = document.getElementById('wholesaleProgressText');
        const progressFill = document.getElementById('wholesaleProgressFill');

        // Elementos barra móvil
        const mobileBottomBar = document.getElementById('mobileBottomBar');
        const mobileBarBadge = document.getElementById('mobileBarBadge');
        const mobileBarCountNum = document.getElementById('mobileBarCountNum');
        const mobileBarTotal = document.getElementById('mobileBarTotal');
        const mobileBarStrip = document.getElementById('mobileBarWholesaleStrip');

        if (countBadge) countBadge.textContent = totals.totalItems;
        if (headerTotal) headerTotal.textContent = formatCurrency(totals.effectiveTotal);
        if (drawerCount) drawerCount.textContent = totals.totalItems;
        if (floatingCount) floatingCount.textContent = totals.totalItems;
        if (cartSubtotalEl) cartSubtotalEl.textContent = formatCurrency(totals.retailSubtotal);
        if (cartTotalEl) cartTotalEl.textContent = formatCurrency(totals.effectiveTotal);

        if (cartSavingsRow && cartSavingsAmount) {
            if (totals.qualifiesWholesale && totals.savings > 0) {
                cartSavingsRow.style.display = 'flex';
                cartSavingsAmount.textContent = '- ' + formatCurrency(totals.savings);
            } else {
                cartSavingsRow.style.display = 'none';
            }
        }

        // Actualizar barra de progreso mayorista ($100.000)
        if (progressFill) {
            progressFill.style.width = `${totals.progressPct}%`;
        }
        if (progressText) {
            if (totals.totalItems === 0) {
                progressText.innerHTML = `<i class="fa-solid fa-boxes-stacked" style="color:#f59e0b;"></i> Superando los <strong>$ 100.000</strong> se activan los <strong>Precios Mayoristas</strong> automáticamente.`;
            } else if (totals.qualifiesWholesale) {
                progressText.innerHTML = `🎉 <strong>¡PRECIO MAYORISTA ACTIVADO!</strong> Estás ahorrando <strong>${formatCurrency(totals.savings)}</strong> en tu pedido.`;
            } else {
                progressText.innerHTML = `🔥 Te faltan <strong>${formatCurrency(totals.remainingForWholesale)}</strong> para activar el <strong>Precio Mayorista</strong> en todo tu pedido (${totals.progressPct}%).`;
            }
        }

        // Barra inferior móvil
        if (mobileBarBadge) mobileBarBadge.textContent = totals.totalItems;
        if (mobileBarCountNum) mobileBarCountNum.textContent = totals.totalItems;
        if (mobileBarTotal) mobileBarTotal.textContent = formatCurrency(totals.effectiveTotal);
        if (mobileBarStrip) {
            if (totals.qualifiesWholesale) {
                mobileBarStrip.innerHTML = `🎉 ¡Precio Mayorista activo! Ahorrás <strong style="color:#4ade80;">${formatCurrency(totals.savings)}</strong>`;
                mobileBarStrip.style.background = '#14532d';
            } else {
                mobileBarStrip.innerHTML = `🔥 Sumá <strong style="color:#facc15;">${formatCurrency(totals.remainingForWholesale)}</strong> más para activar Precio Mayorista`;
                mobileBarStrip.style.background = '#1e293b';
            }
        }

        if (mobileBottomBar) {
            if (totals.totalItems > 0) {
                mobileBottomBar.classList.add('visible');
                if (floatingCount && floatingCount.parentElement) floatingCount.parentElement.style.display = 'none';
            } else {
                mobileBottomBar.classList.remove('visible');
                if (floatingCount && floatingCount.parentElement) floatingCount.parentElement.style.display = '';
            }
        }

        if (wholesaleNotice) {
            wholesaleNotice.style.display = totals.qualifiesWholesale ? 'flex' : 'none';
        }

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
            const prod = !isCombo ? state.products.find(p => String(p.id) === String(it.id)) : null;
            const pMin = prod ? prod.price_minorista : (it.priceMinorista || it.price);
            const pMay = prod ? (prod.price_mayorista || pMin) : (it.priceMayorista || pMin);
            const unitPrice = (!isCombo && totals.qualifiesWholesale) ? pMay : pMin;
            const imgPath = it.image ? `${it.image.replace(/^\/+/, '')}` : 'uploads/logo.jpg';

            html += `
                <div class="cart-item">
                    <div class="cart-item-img">
                        <img src="${imgPath}" onerror="this.src='uploads/logo.jpg'" alt="${it.name}">
                    </div>
                    <div class="cart-item-info">
                        <div class="cart-item-name" title="${it.name}">
                            ${isCombo ? '<span style="color: #d97706;">[COMBO]</span> ' : ''}${it.name}
                        </div>
                        <div class="cart-item-sub">${it.presentation || (isCombo ? 'Bebida + Acompañante' : '')}</div>
                        <div class="cart-item-price">
                            ${formatCurrency(unitPrice * it.qty)} <span style="color:#64748b; font-weight:600;">(${formatCurrency(unitPrice)} c/u${(!isCombo && totals.qualifiesWholesale) ? ' · Mayorista' : ''})</span>
                        </div>
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

    // ----------------- MENÚ HAMBURGUESA DE CATEGORÍAS -----------------
    function openCategoriesMenu() {
        const drawer = document.getElementById('categoriesDrawer');
        const backdrop = document.getElementById('categoriesBackdrop');
        if (drawer && backdrop) {
            drawer.classList.add('open');
            backdrop.classList.add('open');
            drawer.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeCategoriesMenu() {
        const drawer = document.getElementById('categoriesDrawer');
        const backdrop = document.getElementById('categoriesBackdrop');
        if (drawer && backdrop) {
            drawer.classList.remove('open');
            backdrop.classList.remove('open');
            drawer.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
    }

    // ----------------- SWITCH MODO MINORISTA / MAYORISTA -----------------
    function setPriceMode(mode) {
        state.priceMode = mode === 'mayorista' ? 'mayorista' : 'minorista';
        const btnMin = document.getElementById('btnModeMinorista');
        const btnMay = document.getElementById('btnModeMayorista');
        if (btnMin) btnMin.classList.toggle('active', state.priceMode === 'minorista');
        if (btnMay) btnMay.classList.toggle('active', state.priceMode === 'mayorista');
        renderFilteredProducts();
        showToast(
            state.priceMode === 'mayorista'
                ? 'Mostrando Lista Mayorista (compras desde $100.000)'
                : 'Mostrando Lista Minorista por unidad',
            state.priceMode === 'mayorista' ? 'fa-boxes-stacked' : 'fa-bag-shopping'
        );
    }

    // ----------------- CARRUSEL HERO AUTOMÁTICO -----------------
    function initCarousel() {
        const slides = document.querySelectorAll('.carousel-slide');
        const dotsContainer = document.getElementById('carouselDots');
        const prevBtn = document.getElementById('carouselPrevBtn');
        const nextBtn = document.getElementById('carouselNextBtn');
        const track = document.getElementById('carouselTrack');

        if (!slides.length || !dotsContainer) return;

        dotsContainer.innerHTML = '';
        slides.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
            dot.addEventListener('click', () => goToSlide(idx));
            dotsContainer.appendChild(dot);
        });

        function goToSlide(index) {
            slides.forEach((s, idx) => s.classList.toggle('active', idx === index));
            const dots = dotsContainer.querySelectorAll('.carousel-dot');
            dots.forEach((d, idx) => d.classList.toggle('active', idx === index));
            state.carouselIndex = index;
        }

        function nextSlide() {
            goToSlide((state.carouselIndex + 1) % slides.length);
        }

        function prevSlide() {
            goToSlide((state.carouselIndex - 1 + slides.length) % slides.length);
        }

        if (nextBtn) nextBtn.addEventListener('click', nextSlide);
        if (prevBtn) prevBtn.addEventListener('click', prevSlide);

        function startTimer() {
            stopTimer();
            state.carouselTimer = setInterval(nextSlide, 5500);
        }

        function stopTimer() {
            if (state.carouselTimer) clearInterval(state.carouselTimer);
        }

        startTimer();
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
            const imgPath = c.image_path ? `${c.image_path.replace(/^\/+/, '')}` : 'uploads/logo.jpg';
            const itemsList = (c.items || []).map(it => `<li><i class="fa-solid fa-check"></i> ${it.qty}x ${it.name}</li>`).join('');
            const inCartQty = getCartQtyForItem(c.id, 'combo');

            html += `
                <div class="combo-card ${inCartQty > 0 ? 'in-cart-active' : ''}">
                    ${inCartQty > 0 ? `<span class="in-cart-pill"><i class="fa-solid fa-check"></i> En tu pedido (${inCartQty})</span>` : (c.badge ? `<span class="combo-badge-pill">${c.badge}</span>` : '')}
                    <div class="combo-image-box">
                        <img src="${imgPath}" onerror="this.src='uploads/logo.jpg'" alt="${c.name}">
                    </div>
                    <div class="combo-content">
                        <h3 class="combo-name">${c.name}</h3>
                        ${c.description ? `<p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${c.description}</p>` : ''}
                        <ul class="combo-items-list">
                            ${itemsList}
                        </ul>
                        <div class="combo-price-row">
                            <span class="combo-price">${formatCurrency(c.price)}</span>
                            ${c.regular_price > c.price ? `<span class="combo-regular-price">Antes: ${formatCurrency(c.regular_price)}</span>` : ''}
                        </div>
                        <button class="btn-add-combo" onclick="tiendaApp.addComboById(${c.id})">
                            <i class="fa-solid fa-cart-plus"></i> ${inCartQty > 0 ? 'Agregar otro Combo' : 'Agregar Combo'}
                        </button>
                    </div>
                </div>
            `;
        });

        grid.innerHTML = html;
    }

    function updateCarouselPricing() {
        if (!state.combos || !state.combos.length) return;
        const slides = document.querySelectorAll('.carousel-slide');
        slides.forEach(slide => {
            const addBtn = slide.querySelector('button[onclick*="addComboById"]');
            if (!addBtn) return;
            const match = addBtn.getAttribute('onclick').match(/addComboById\((\d+)\)/);
            if (!match) return;
            const comboId = parseInt(match[1], 10);
            const combo = state.combos.find(c => c.id === comboId);
            if (!combo) return;

            const priceEl = slide.querySelector('.slide-price');
            const regularEl = slide.querySelector('.slide-regular-price');
            const savingsEl = slide.querySelector('.slide-savings');

            if (priceEl && combo.price) priceEl.textContent = formatCurrency(combo.price);
            if (regularEl && combo.regular_price > combo.price) {
                regularEl.textContent = `Antes: ${formatCurrency(combo.regular_price)}`;
                regularEl.style.display = '';
            }
            if (savingsEl && combo.regular_price > combo.price) {
                const diff = combo.regular_price - combo.price;
                savingsEl.textContent = `¡Ahorrás ${formatCurrency(diff)}!`;
                savingsEl.style.display = '';
            }
        });
    }

    // ----------------- RENDERIZADO DE CATEGORÍAS (DRAWER + PILLS) -----------------
    function getCategoryIcon(catName, defaultIcon) {
        if (defaultIcon && defaultIcon.trim()) return defaultIcon;
        const n = (catName || '').toUpperCase();
        if (n.includes('CERVEZA')) return 'fa-solid fa-beer-mug-empty';
        if (n.includes('VINO') || n.includes('ESPUMANTE') || n.includes('SIDRA')) return 'fa-solid fa-wine-bottle';
        if (n.includes('WHISK')) return 'fa-solid fa-whiskey-glass';
        if (n.includes('VODKA') || n.includes('GIN') || n.includes('RON') || n.includes('LICOR')) return 'fa-solid fa-martini-glass-citrus';
        if (n.includes('FERNET') || n.includes('APERITIVO')) return 'fa-solid fa-wine-glass';
        if (n.includes('GASEOSA') || n.includes('AGUA') || n.includes('JUGO') || n.includes('SIN ALCOHOL')) return 'fa-solid fa-bottle-water';
        if (n.includes('ENERGIZANTE')) return 'fa-solid fa-bolt';
        if (n.includes('SNACK') || n.includes('PAPA')) return 'fa-solid fa-bowl-food';
        return 'fa-solid fa-wine-glass';
    }

    function renderCategories() {
        const pillsContainer = document.getElementById('categoryPills');
        const drawerGrid = document.getElementById('categoriesDrawerGrid');
        const activeLabel = document.getElementById('activeCategoryLabel');

        const totalProds = state.products.filter(p => !p.category_name || p.category_name.toUpperCase() !== 'COMBOS').length;

        // Actualizar texto del botón Hamburguesa
        if (activeLabel) {
            if (state.activeCategory === 'all') {
                activeLabel.textContent = `Todos los Productos (${totalProds})`;
            } else if (state.activeCategory === 'combos' || state.activeCategory === 'Combos') {
                activeLabel.textContent = `🔥 Combos Especiales (${state.combos.length})`;
            } else {
                const foundCat = state.categories.find(c => String(c.id) === String(state.activeCategory));
                activeLabel.textContent = foundCat ? `${foundCat.name} (${foundCat.product_count})` : 'Todos los Productos';
            }
        }

        // 1. Renderizar pastillas PC
        if (pillsContainer) {
            let pillsHtml = `
                <button class="pill-btn ${state.activeCategory === 'all' ? 'active' : ''}" data-category="all">
                    <i class="fa-solid fa-layer-group"></i> Todos (${totalProds})
                </button>
                <button class="pill-btn ${state.activeCategory === 'combos' ? 'active' : ''}" data-category="combos">
                    <i class="fa-solid fa-fire"></i> Combos (${state.combos.length})
                </button>
            `;

            state.categories.forEach(cat => {
                if (cat.name && cat.name.toUpperCase() === 'COMBOS') return;
                const isActive = String(state.activeCategory) === String(cat.id);
                const iconClass = getCategoryIcon(cat.name, cat.icon);
                pillsHtml += `
                    <button class="pill-btn ${isActive ? 'active' : ''}" data-category="${cat.id}">
                        <i class="${iconClass}"></i> ${cat.name} (${cat.product_count})
                    </button>
                `;
            });
            pillsContainer.innerHTML = pillsHtml;
            pillsContainer.querySelectorAll('.pill-btn').forEach(btn => {
                btn.addEventListener('click', () => filterByCategory(btn.getAttribute('data-category')));
            });
        }

        // 2. Renderizar Grilla 2 Columnas en el Menú Hamburguesa
        if (drawerGrid) {
            let drawerHtml = `
                <button class="cat-drawer-card full-span ${state.activeCategory === 'all' ? 'active' : ''}" data-category="all">
                    <div class="cat-drawer-icon"><i class="fa-solid fa-layer-group"></i></div>
                    <div class="cat-drawer-info">
                        <span class="cat-drawer-name">Todos los Productos</span>
                        <span class="cat-drawer-count">${totalProds} bebidas disponibles</span>
                    </div>
                </button>
                <button class="cat-drawer-card full-span ${state.activeCategory === 'combos' ? 'active' : ''}" data-category="combos">
                    <div class="cat-drawer-icon"><i class="fa-solid fa-fire"></i></div>
                    <div class="cat-drawer-info">
                        <span class="cat-drawer-name">🔥 Combos con Acompañante</span>
                        <span class="cat-drawer-count">${state.combos.length} promos listas</span>
                    </div>
                </button>
            `;

            state.categories.forEach(cat => {
                if (cat.name && cat.name.toUpperCase() === 'COMBOS') return;
                const isActive = String(state.activeCategory) === String(cat.id);
                const iconClass = getCategoryIcon(cat.name, cat.icon);
                drawerHtml += `
                    <button class="cat-drawer-card ${isActive ? 'active' : ''}" data-category="${cat.id}">
                        <div class="cat-drawer-icon"><i class="${iconClass}"></i></div>
                        <div class="cat-drawer-info">
                            <span class="cat-drawer-name">${cat.name}</span>
                            <span class="cat-drawer-count">${cat.product_count} productos</span>
                        </div>
                    </button>
                `;
            });

            drawerGrid.innerHTML = drawerHtml;
            drawerGrid.querySelectorAll('.cat-drawer-card').forEach(card => {
                card.addEventListener('click', () => {
                    const cat = card.getAttribute('data-category');
                    closeCategoriesMenu();
                    filterByCategory(cat);
                });
            });
        }
    }

    function filterByCategory(category) {
        state.activeCategory = category;
        renderCategories();

        if (category === 'combos' || category === 'Combos') {
            state.searchQuery = '';
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.style.display = 'none';

            renderFilteredProducts();
            const combosEl = document.getElementById('combosSection');
            if (combosEl) combosEl.scrollIntoView({ behavior: 'smooth' });
            return;
        }

        renderFilteredProducts();
        const catBar = document.getElementById('catalogSection');
        if (catBar) {
            catBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ----------------- RENDERIZADO DE PRODUCTOS -----------------
    function renderFilteredProducts() {
        const grid = document.getElementById('productsGrid');
        const emptyState = document.getElementById('noResultsState');
        const resultsCountEl = document.getElementById('resultsCountText');
        const filterBadge = document.getElementById('activeFilterBadge');
        const resetQuickBtn = document.getElementById('resetCategoryQuickBtn');
        const combosSection = document.getElementById('combosSection');
        const heroCarouselSection = document.getElementById('heroCarouselSection');
        const trustBannerSection = document.querySelector('.trust-banner-section');

        if (!grid) return;

        const hasSearch = !!(state.searchQuery && state.searchQuery.trim().length > 0);
        const hasCatFilter = state.activeCategory !== 'all' && state.activeCategory !== 'combos';

        if (combosSection) combosSection.style.display = (hasSearch || hasCatFilter) ? 'none' : '';
        if (heroCarouselSection) heroCarouselSection.style.display = (hasSearch || hasCatFilter) ? 'none' : '';
        if (trustBannerSection) trustBannerSection.style.display = (hasSearch || hasCatFilter) ? 'none' : '';

        let filtered = state.products.filter(p => !p.category_name || p.category_name.toUpperCase() !== 'COMBOS');

        if (hasCatFilter) {
            filtered = filtered.filter(p => String(p.category_id) === String(state.activeCategory));
            const catObj = state.categories.find(c => String(c.id) === String(state.activeCategory));
            if (catObj && filterBadge && !hasSearch) {
                filterBadge.textContent = catObj.name;
                filterBadge.style.display = 'inline-block';
            }
        } else if (!hasSearch) {
            if (filterBadge) filterBadge.style.display = 'none';
        }

        if (hasSearch) {
            const q = state.searchQuery.toLowerCase().trim();
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(q) ||
                (p.presentation && p.presentation.toLowerCase().includes(q)) ||
                (p.category_name && p.category_name.toLowerCase().includes(q))
            );
            if (filterBadge) {
                filterBadge.textContent = `Búsqueda: "${state.searchQuery.trim()}"`;
                filterBadge.style.display = 'inline-block';
            }
        }

        if (resetQuickBtn) {
            resetQuickBtn.style.display = (hasSearch || hasCatFilter) ? 'inline-flex' : 'none';
        }

        // Ordenamiento
        if (state.sortBy === 'price-asc') {
            filtered.sort((a, b) => a.price_minorista - b.price_minorista);
        } else if (state.sortBy === 'price-desc') {
            filtered.sort((a, b) => b.price_minorista - a.price_minorista);
        } else if (state.sortBy === 'name-asc') {
            filtered.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            filtered.sort((a, b) => (b.is_featured || 0) - (a.is_featured || 0));
        }

        if (resultsCountEl) {
            resultsCountEl.textContent = `${filtered.length} producto${filtered.length === 1 ? '' : 's'} disponible${filtered.length === 1 ? '' : 's'}`;
        }

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const isMayoristaMode = state.priceMode === 'mayorista';
        let html = '';

        filtered.forEach(p => {
            const imgPath = p.image_path ? `${p.image_path.replace(/^\/+/, '')}` : 'uploads/logo.jpg';
            const inCartQty = getCartQtyForItem(p.id, 'product');

            let stockBadge = '';
            if (p.is_out_of_stock) {
                stockBadge = '<span class="out-of-stock-badge">Agotado</span>';
            } else if (p.is_low_stock && p.low_stock_count) {
                const text = p.low_stock_count === 1 ? '¡Última!' : `¡Últimas ${p.low_stock_count}!`;
                stockBadge = `<span class="low-stock-badge"><i class="fa-solid fa-fire"></i> ${text}</span>`;
            }

            const topLeftBadge = inCartQty > 0
                ? `<span class="in-cart-pill"><i class="fa-solid fa-check"></i> En tu pedido (${inCartQty})</span>`
                : (p.is_featured ? '<span class="featured-badge">⭐ Destacado</span>' : '');

            const pricingHtml = isMayoristaMode
                ? `
                    <div class="product-price-mayorista" style="padding: 6px 10px;">
                        <span>MAYORISTA:</span>
                        <strong style="font-size: 22px;">${formatCurrency(p.price_mayorista || p.price_minorista)}</strong>
                    </div>
                    <div style="font-size: 11.5px; color: #64748b; font-weight: 600;">
                        Minorista x unidad: ${formatCurrency(p.price_minorista)}
                    </div>
                  `
                : `
                    <div class="product-price-minorista">
                        ${formatCurrency(p.price_minorista)} <small>x unidad</small>
                    </div>
                    <div class="product-price-mayorista">
                        <span>Mayorista (&gt;$100k)</span>
                        <strong>${formatCurrency(p.price_mayorista || p.price_minorista)}</strong>
                    </div>
                  `;

            html += `
                <div class="product-card ${inCartQty > 0 ? 'in-cart-active' : ''}" data-product-id="${p.id}">
                    ${stockBadge}
                    ${topLeftBadge}
                    <div class="product-image-container">
                        <img src="${imgPath}" onerror="this.src='uploads/logo.jpg'" alt="${p.name}" loading="lazy">
                    </div>
                    <div class="product-info">
                        <span class="product-category-tag">${p.category_name}</span>
                        <h3 class="product-name" title="${p.name}">${p.name}</h3>
                        <div class="product-presentation">${p.presentation || 'Unidad'}</div>
                        
                        <div class="product-pricing-box">
                            ${pricingHtml}
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
                                <i class="fa-solid fa-cart-plus"></i> ${p.is_out_of_stock ? 'Agotado' : (inCartQty > 0 ? 'Sumar' : 'Pedir')}
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
        const totals = getCartTotals();

        let itemsText = '';
        state.cart.forEach(it => {
            const isCombo = it.type === 'combo';
            const prod = !isCombo ? state.products.find(p => String(p.id) === String(it.id)) : null;
            const pMin = prod ? prod.price_minorista : (it.priceMinorista || it.price);
            const pMay = prod ? (prod.price_mayorista || pMin) : (it.priceMayorista || pMin);
            const unitPrice = (!isCombo && totals.qualifiesWholesale) ? pMay : pMin;

            const prefix = isCombo ? '🔥 [COMBO] ' : '• ';
            const pres = it.presentation ? ` (${it.presentation})` : '';
            itemsText += `${prefix}${it.qty}x ${it.name}${pres} — ${formatCurrency(unitPrice * it.qty)}
`;
        });

        let msg = `🛒 *NUEVO PEDIDO - BEBIDAS 25 DE MAYO*
`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        msg += `👤 *Cliente:* ${customer.name}
`;
        msg += `📞 *Teléfono:* ${customer.phone}
`;
        msg += `🛵 *Modalidad:* ${customer.deliveryType}
`;
        if (customer.address && customer.deliveryType.includes('Envío')) {
            msg += `📍 *Dirección:* ${customer.address}
`;
        }
        msg += `💳 *Medio de Pago:* ${customer.payment}
`;
        if (customer.notes) {
            msg += `📝 *Aclaraciones:* ${customer.notes}
`;
        }
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        msg += `📦 *DETALLE DEL PEDIDO (${totals.qualifiesWholesale ? 'LISTA MAYORISTA' : 'LISTA MINORISTA'}):*
${itemsText}`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        if (totals.qualifiesWholesale && totals.savings > 0) {
            msg += `🎉 *Ahorro Mayorista aplicado: -${formatCurrency(totals.savings)}*
`;
        }
        msg += `💰 *TOTAL FINAL: ${formatCurrency(totals.effectiveTotal)}*
`;
        msg += `━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        msg += `¡Hola Bebidas 25 de Mayo! Envío mi pedido desde la tienda web. ¡Muchas gracias!`;

        return msg;
    }

    function sendWhatsappOrder() {
        const customer = validateCheckout();
        if (!customer) return;
        const summaryText = buildOrderSummaryText(customer);
        const phone = state.config.whatsapp_phone || '5491176265350';
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(summaryText)}`, '_blank');
    }

    function sendEmailOrder() {
        const customer = validateCheckout();
        if (!customer) return;
        const totals = getCartTotals();
        const summaryText = buildOrderSummaryText(customer);
        const email = state.config.email || 'bebidas.25demayo@hotmail.com';
        const subject = encodeURIComponent(`Nuevo Pedido Web - ${customer.name} (${formatCurrency(totals.effectiveTotal)})`);
        window.location.href = `mailto:${email}?subject=${subject}&body=${encodeURIComponent(summaryText)}`;
    }

    // ----------------- EVENT LISTENERS Y SCROLL FAB -----------------
    function setupEventListeners() {
        const openCartBtn = document.getElementById('openCartBtn');
        const floatingCartBtn = document.getElementById('floatingCartBtn');
        const closeCartBtn = document.getElementById('closeCartBtn');
        const cartBackdrop = document.getElementById('cartBackdrop');

        if (openCartBtn) openCartBtn.addEventListener('click', openCart);
        if (floatingCartBtn) floatingCartBtn.addEventListener('click', openCart);
        if (closeCartBtn) closeCartBtn.addEventListener('click', closeCart);
        if (cartBackdrop) cartBackdrop.addEventListener('click', closeCart);

        const searchInput = document.getElementById('searchInput');
        const clearSearchBtn = document.getElementById('clearSearchBtn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.searchQuery = e.target.value;
                if (clearSearchBtn) clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
                renderFilteredProducts();
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    searchInput.blur();
                }
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                state.searchQuery = '';
                clearSearchBtn.style.display = 'none';
                renderFilteredProducts();
            });
        }

        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                state.sortBy = e.target.value;
                renderFilteredProducts();
            });
        }

        const deliveryRadios = document.querySelectorAll('input[name="deliveryType"]');
        const addressGroup = document.getElementById('addressFieldGroup');
        deliveryRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (addressGroup) addressGroup.style.display = e.target.value === 'delivery' ? 'block' : 'none';
            });
        });

        const btnWhatsapp = document.getElementById('sendWhatsappOrderBtn');
        const btnEmail = document.getElementById('sendEmailOrderBtn');
        if (btnWhatsapp) btnWhatsapp.addEventListener('click', sendWhatsappOrder);
        if (btnEmail) btnEmail.addEventListener('click', sendEmailOrder);

        // Mostrar/ocultar botones rápidos flotantes al bajar por el catálogo
        const quickFabGroup = document.getElementById('quickFabGroup');
        window.addEventListener('scroll', () => {
            if (!quickFabGroup) return;
            if (window.scrollY > 360) {
                quickFabGroup.classList.add('visible');
            } else {
                quickFabGroup.classList.remove('visible');
            }
        }, { passive: true });
    }

    // ----------------- CARGA DE DATOS INICIAL -----------------
    async function initApp() {
        setupEventListeners();
        loadCartFromStorage();

        try {
            const fetchEndpoint = async (name) => {
                const bust = '?v=' + Date.now();
                try {
                    const r1 = await fetch(`api/public/${name}.json${bust}`);
                    if (r1.ok) return await r1.json();
                } catch (e) {}
                const r2 = await fetch(`/api/public/${name}${bust}`);
                if (r2.ok) return await r2.json();
                return null;
            };

            const [confData, combosData, catsData, prodsData] = await Promise.all([
                fetchEndpoint('info'),
                fetchEndpoint('combos'),
                fetchEndpoint('categories'),
                fetchEndpoint('products')
            ]);

            if (confData) state.config = confData;
            if (combosData) {
                state.combos = combosData;
                renderCombos();
                updateCarouselPricing();
            }
            if (prodsData) {
                state.products = prodsData;
            }
            if (catsData) {
                state.categories = catsData;
                renderCategories();
            }
            renderFilteredProducts();
            updateCartUI();
            initCarousel();

        } catch (err) {
            console.error('Error cargando catálogo público:', err);
            showToast('Error de conexión al cargar el catálogo', 'fa-triangle-exclamation');
        }
    }

    // ----------------- ZOOM LIGHTBOX -----------------
    function openImageZoomModal(item) {
        const modal = document.getElementById('imageZoomModal');
        const img = document.getElementById('zoomModalImg');
        const cat = document.getElementById('zoomModalCategory');
        const title = document.getElementById('zoomModalTitle');
        const pres = document.getElementById('zoomModalPres');
        const prices = document.getElementById('zoomModalPrices');
        const cartBtn = document.getElementById('zoomModalCartBtn');

        if (!modal || !img) return;

        img.src = item.image || 'uploads/logo.jpg';
        img.alt = item.name || '';
        if (cat) cat.innerText = item.category || 'BEBIDAS 25 DE MAYO';
        if (title) title.innerText = item.name || '';
        if (pres) pres.innerText = item.presentation || '';

        if (prices) {
            let pricesHtml = '';
            if (item.priceMinorista !== undefined && item.priceMinorista !== null) {
                const pMin = typeof item.priceMinorista === 'number' ? formatCurrency(item.priceMinorista) : item.priceMinorista;
                pricesHtml += `
                    <div class="image-zoom-price-box">
                        <span class="image-zoom-price-label">Precio Minorista</span>
                        <span class="image-zoom-price-val">${pMin}</span>
                    </div>
                `;
            }
            if (item.priceMayorista !== undefined && item.priceMayorista !== null && item.priceMayorista > 0) {
                pricesHtml += `
                    <div class="image-zoom-price-box mayorista">
                        <span class="image-zoom-price-label">Mayorista (&gt;$100k)</span>
                        <span class="image-zoom-price-val">${formatCurrency(item.priceMayorista)}</span>
                    </div>
                `;
            }
            prices.innerHTML = pricesHtml;
        }

        if (cartBtn) {
            cartBtn.onclick = () => {
                if (item.isCombo && item.comboObj) {
                    addToCart({
                        id: item.comboObj.id,
                        type: 'combo',
                        name: item.comboObj.name,
                        presentation: 'Promo Pack',
                        price: item.comboObj.price,
                        qty: 1,
                        image: item.comboObj.image_path
                    });
                } else if (item.productId) {
                    const prod = state.products.find(p => String(p.id) === String(item.productId));
                    if (prod) {
                        addToCart({
                            id: prod.id,
                            type: 'product',
                            name: prod.name,
                            presentation: prod.presentation,
                            price: prod.price_minorista,
                            priceMinorista: prod.price_minorista,
                            priceMayorista: prod.price_mayorista || prod.price_minorista,
                            qty: 1,
                            image: prod.image_path
                        });
                    }
                }
                closeImageZoomModal();
            };
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeImageZoomModal() {
        const modal = document.getElementById('imageZoomModal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    }

    window.closeImageZoomModal = closeImageZoomModal;
    window.openImageZoomModal = openImageZoomModal;

    document.addEventListener('click', (e) => {
        const prodImgBox = e.target.closest('.product-image-container');
        if (prodImgBox) {
            const card = prodImgBox.closest('.product-card');
            if (card) {
                const prodId = card.getAttribute('data-product-id');
                const prod = state.products.find(p => String(p.id) === String(prodId));
                if (prod) {
                    openImageZoomModal({
                        image: prod.image_path ? `${prod.image_path.replace(/^\/+/, '')}` : 'uploads/logo.jpg',
                        name: prod.name,
                        category: prod.category_name,
                        presentation: prod.presentation || 'Unidad',
                        priceMinorista: prod.price_minorista,
                        priceMayorista: prod.price_mayorista,
                        productId: prod.id,
                        isCombo: false
                    });
                }
            }
            return;
        }

        const comboImgBox = e.target.closest('.combo-image-box');
        if (comboImgBox) {
            const card = comboImgBox.closest('.combo-card');
            const img = comboImgBox.querySelector('img');
            const titleEl = card ? card.querySelector('.combo-name') : null;
            if (img && titleEl) {
                const comboName = titleEl.innerText.trim();
                const comboObj = state.combos.find(c => c.name.trim().toLowerCase() === comboName.toLowerCase());
                openImageZoomModal({
                    image: img.src,
                    name: comboName,
                    category: 'COMBO ESPECIAL',
                    presentation: 'Promo Pack',
                    priceMinorista: comboObj ? comboObj.price : null,
                    priceMayorista: null,
                    comboObj: comboObj,
                    isCombo: true
                });
            }
            return;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeImageZoomModal();
            closeCategoriesMenu();
            closeCart();
        }
    });

    window.tiendaApp = {
        openCart: openCart,
        closeCart: closeCart,
        openCategoriesMenu: openCategoriesMenu,
        closeCategoriesMenu: closeCategoriesMenu,
        setPriceMode: setPriceMode,
        scrollToTop: function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        focusSearchTop: function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => {
                const searchInput = document.getElementById('searchInput');
                if (searchInput) searchInput.focus();
            }, 350);
        },
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
                priceMinorista: prod.price_minorista,
                priceMayorista: prod.price_mayorista || prod.price_minorista,
                qty: qty,
                image: prod.image_path
            });
            if (qtyInput) qtyInput.value = 1;
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
