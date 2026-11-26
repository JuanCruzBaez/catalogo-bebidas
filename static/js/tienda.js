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
        activeComboTab: 'all',
        priceMode: 'minorista', // 'minorista' | 'mayorista'
        searchQuery: '',
        sortBy: 'featured',
        carouselIndex: 0,
        carouselTimer: null,
        activeDetail: null // { type: 'product' | 'combo', id: number }
    };

    function slugifyText(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'item';
    }

    function getProductSlug(p) {
        return p.slug || `${slugifyText(`${p.name || ''} ${p.presentation || ''}`)}-${p.id}`;
    }

    function getComboSlug(c) {
        return c.slug || `${slugifyText(c.name || '')}-${c.id}`;
    }

    function getAbsoluteImg(relPath) {
        if (!relPath) return '/uploads/logo.jpg';
        if (/^https?:\/\//i.test(relPath)) return relPath;
        return '/' + relPath.replace(/^\/+/, '');
    }

    function getItemPath(type, item) {
        if (type === 'combo') return `/combo/${getComboSlug(item)}`;
        return `/producto/${getProductSlug(item)}`;
    }

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
        const cartSurchargeRow = document.getElementById('cartSurchargeRow');
        const cartSurchargeLabel = document.getElementById('cartSurchargeLabel');
        const cartSurchargeAmount = document.getElementById('cartSurchargeAmount');

        // Recargo según medio de pago seleccionado (Débito +2%, Crédito +7%, Efectivo/Transferencia 0%)
        const payInfo = getSelectedPaymentInfo();
        const surchargeAmount = payInfo.surchargePct > 0 ? Math.round(totals.effectiveTotal * (payInfo.surchargePct / 100)) : 0;
        const grandTotal = totals.effectiveTotal + surchargeAmount;

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
        if (cartTotalEl) cartTotalEl.textContent = formatCurrency(grandTotal);

        if (cartSurchargeRow && cartSurchargeAmount) {
            if (surchargeAmount > 0 && totals.totalItems > 0) {
                if (cartSurchargeLabel) cartSurchargeLabel.textContent = `Recargo ${payInfo.label} (+${payInfo.surchargePct}%)`;
                cartSurchargeAmount.textContent = '+ ' + formatCurrency(surchargeAmount);
                cartSurchargeRow.style.display = 'flex';
            } else {
                cartSurchargeRow.style.display = 'none';
            }
        }

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

    // ----------------- CARRUSEL HERO AUTOMÁTICO Y MANUAL -----------------
    function initCarousel() {
        const slides = document.querySelectorAll('.carousel-slide');
        const dotsContainer = document.getElementById('carouselDots');
        const prevBtn = document.getElementById('carouselPrevBtn');
        const nextBtn = document.getElementById('carouselNextBtn');
        const track = document.getElementById('carouselTrack');
        const wrapper = document.querySelector('.carousel-wrapper');

        if (!slides.length || !dotsContainer) return;

        dotsContainer.innerHTML = '';
        slides.forEach((_, idx) => {
            const dot = document.createElement('div');
            dot.className = `carousel-dot ${idx === 0 ? 'active' : ''}`;
            dot.addEventListener('click', () => {
                goToSlide(idx);
                startTimer();
            });
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

        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                nextSlide();
                startTimer();
            });
        }
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                prevSlide();
                startTimer();
            });
        }

        function startTimer() {
            stopTimer();
            state.carouselTimer = setInterval(nextSlide, 5500);
        }

        function stopTimer() {
            if (state.carouselTimer) clearInterval(state.carouselTimer);
        }

        startTimer();

        const targetEl = wrapper || track;
        if (targetEl) {
            targetEl.addEventListener('mouseenter', stopTimer);
            targetEl.addEventListener('mouseleave', startTimer);

            // Soporte de deslizamiento táctil (swipe) para móvil y tablet
            let touchStartX = 0;
            let touchStartY = 0;
            targetEl.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length > 0) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                    stopTimer();
                }
            }, { passive: true });

            targetEl.addEventListener('touchend', (e) => {
                if (e.changedTouches && e.changedTouches.length > 0) {
                    const dx = e.changedTouches[0].clientX - touchStartX;
                    const dy = e.changedTouches[0].clientY - touchStartY;
                    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                        if (dx < 0) nextSlide();
                        else prevSlide();
                    }
                    startTimer();
                }
            }, { passive: true });
        }
    }

    // ----------------- CATEGORIZACIÓN Y RENDERIZADO DE COMBOS -----------------
    const COMBO_TABS = [
        { id: 'all', label: '🔥 Todos' },
        { id: 'cervezas', label: '🍺 Packs Cervezas' },
        { id: 'vodkas', label: '⚡ Vodkas y Tragos' },
        { id: 'gin', label: '🍸 Gin Tonic' },
        { id: 'whiskies', label: '🥃 Whiskies y Licores' },
        { id: 'aperitivos', label: '🍹 Fernet, Ron y Aperitivos' },
        { id: 'sidras_vinos', label: '🥂 Sidras, Vinos y Espumantes' },
        { id: 'sin_alcohol', label: '🥤 Packs Sin Alcohol' }
    ];

    function getComboTabId(c) {
        const txt = `${c.name || ''} ${c.description || ''}`.toLowerCase();
        if (/\bgin\b|beefeater|aconcagua|gordon|heredero/.test(txt)) return 'gin';
        if (/whisk|jack daniel|johnnie walker|\bjw\b|jameson|jaggermeister|jagermeister/.test(txt)) return 'whiskies';
        if (/vodka|skyy|smirnoff|absolut|dr\.?\s*lemon/.test(txt)) return 'vodkas';
        if (/fernet|gancia|cinzano|campari|aperol|\bron\b|bacardi|malibu|havana/.test(txt)) return 'aperitivos';
        if (/sidra|anana fizz|ananá fizz|champagne|espumante|federico de alvear|vino|balbo|col[oó]n/.test(txt)) return 'sidras_vinos';
        if (/cerveza|corona|heineken|stella|quilmes|imperial|schneider|warsteiner|miller|michelob|goyeneche|patagonia/.test(txt)) return 'cervezas';
        return 'sin_alcohol';
    }

    function renderComboTabs() {
        const bar = document.getElementById('combosTabsBar');
        if (!bar) return;

        const counts = { all: state.combos.length };
        state.combos.forEach(c => {
            const tid = getComboTabId(c);
            counts[tid] = (counts[tid] || 0) + 1;
        });

        let html = '';
        COMBO_TABS.forEach(tab => {
            const cnt = counts[tab.id] || 0;
            if (tab.id !== 'all' && cnt === 0) return;
            const isActive = state.activeComboTab === tab.id;
            html += `
                <button type="button"
                    class="combo-tab-btn ${isActive ? 'active' : ''}"
                    role="tab"
                    aria-selected="${isActive ? 'true' : 'false'}"
                    onclick="tiendaApp.setComboTab('${tab.id}')">
                    <span>${tab.label}</span>
                    <span class="combo-tab-count">${cnt}</span>
                </button>
            `;
        });
        bar.innerHTML = html;
    }

    function setComboTab(tabId) {
        state.activeComboTab = tabId || 'all';
        renderComboTabs();
        renderCombos();
        const grid = document.getElementById('combosGrid');
        if (grid) grid.scrollLeft = 0;
    }

    function renderCombos() {
        const grid = document.getElementById('combosGrid');
        if (!grid) return;

        renderComboTabs();

        const visibleCombos = state.activeComboTab === 'all'
            ? state.combos
            : state.combos.filter(c => getComboTabId(c) === state.activeComboTab);

        if (visibleCombos.length === 0) {
            grid.innerHTML = '<p class="empty-state">No hay combos disponibles en esta categoría.</p>';
            return;
        }

        let html = '';
        visibleCombos.forEach(c => {
            const imgPath = getAbsoluteImg(c.image_path);
            const itemsList = (c.items || []).map(it => `<li><i class="fa-solid fa-check"></i> ${it.qty}x ${it.name}</li>`).join('');
            const inCartQty = getCartQtyForItem(c.id, 'combo');

            html += `
                <div class="combo-card ${inCartQty > 0 ? 'in-cart-active' : ''}" data-combo-id="${c.id}">
                    ${inCartQty > 0 ? `<span class="in-cart-pill"><i class="fa-solid fa-check"></i> En tu pedido (${inCartQty})</span>` : (c.badge ? `<span class="combo-badge-pill">${c.badge}</span>` : '')}
                    <div class="combo-image-box">
                        <img src="${imgPath}" onerror="this.src='/uploads/logo.jpg'" alt="${c.name}">
                    </div>
                    <div class="combo-content">
                        <h3 class="combo-name">${c.name}</h3>
                        ${c.description ? `<p class="combo-desc-text" style="font-size: 11px; color: #64748b; margin-bottom: 6px; line-height: 1.25;">${c.description}</p>` : ''}
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
        if (state.activeDetail) closeItemDetail(true);
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
            const imgPath = getAbsoluteImg(p.image_path);
            const inCartQty = getCartQtyForItem(p.id, 'product');

            let stockBadge = '';
            if (p.is_out_of_stock) {
                stockBadge = '<span class="out-of-stock-badge">Agotado</span>';
            } else if (p.is_low_stock && p.low_stock_count === 1) {
                stockBadge = '<span class="low-stock-badge"><i class="fa-solid fa-fire"></i> ¡Última unidad!</span>';
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
                        <img src="${imgPath}" onerror="this.src='/uploads/logo.jpg'" alt="${p.name}" loading="lazy">
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

    function getSelectedPaymentInfo() {
        const paymentSel = document.getElementById('paymentMethod');
        const val = paymentSel ? paymentSel.value : 'Efectivo';
        if (val === 'Tarjeta de Débito') {
            return { method: 'debito', label: 'Tarjeta de Débito', isOnline: true, surchargePct: 2 };
        }
        if (val === 'Tarjeta de Crédito') {
            return { method: 'credito', label: 'Tarjeta de Crédito', isOnline: true, surchargePct: 7 };
        }
        return { method: val, label: val, isOnline: false, surchargePct: 0 };
    }

    function updatePaymentModeUI() {
        const paymentSel = document.getElementById('paymentMethod');
        const mpBtn = document.getElementById('payMercadoPagoBtn');
        const mpHint = document.getElementById('mpPaymentHint');
        const mpHintText = document.getElementById('mpPaymentHintText');
        const waBtn = document.getElementById('sendWhatsappOrderBtn');
        if (!paymentSel) return;

        const info = getSelectedPaymentInfo();
        if (mpBtn) {
            mpBtn.style.display = info.isOnline ? 'inline-flex' : 'none';
            const mpSpan = mpBtn.querySelector('span');
            if (mpSpan) {
                mpSpan.textContent = info.method === 'debito'
                    ? 'Pagar con Débito en Mercado Pago (+2%)'
                    : 'Pagar con Crédito en Mercado Pago (+7%)';
            }
        }
        if (mpHint) {
            mpHint.style.display = info.isOnline ? 'flex' : 'none';
            if (mpHintText && info.isOnline) {
                mpHintText.innerHTML = info.method === 'debito'
                    ? 'Pagás con <strong>Tarjeta de Débito</strong> (o saldo MP) en Mercado Pago. Incluye <strong>+2%</strong> de recargo.'
                    : 'Pagás con <strong>Tarjeta de Crédito</strong> en Mercado Pago. Incluye <strong>+7%</strong> de recargo.';
            }
        }
        if (waBtn) {
            const span = waBtn.querySelector('span');
            if (span) {
                span.textContent = info.isOnline
                    ? 'O consultar / pedir por WhatsApp'
                    : 'Confirmar Pedido por WhatsApp';
            }
        }
        updateCartUI();
    }

    async function payWithMercadoPago() {
        const customer = validateCheckout();
        if (!customer) return;
        const payInfo = getSelectedPaymentInfo();

        const mpBtn = document.getElementById('payMercadoPagoBtn');
        const origHtml = mpBtn ? mpBtn.innerHTML : '';
        if (mpBtn) {
            mpBtn.disabled = true;
            mpBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Conectando con Mercado Pago...</span>';
        }

        try {
            const itemsPayload = state.cart.map(it => ({
                id: it.id,
                type: it.type || 'product',
                qty: parseInt(it.qty || 1, 10)
            }));

            const res = await fetch('/api/crear-pago', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: itemsPayload,
                    customer: customer,
                    payment_method: payInfo.method
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.init_point) {
                const msg = data.error || 'No se pudo iniciar el pago online. Podés finalizar tu pedido por WhatsApp.';
                showToast(msg, 'fa-triangle-exclamation');
                alert(msg);
                return;
            }

            // Guardar el resumen del pedido para confirmarlo por WhatsApp al volver de Mercado Pago
            const summaryText = buildOrderSummaryText(customer);
            try {
                localStorage.setItem('b25_pending_mp_order', JSON.stringify({
                    order_ref: data.order_ref,
                    total: data.total,
                    summaryText: summaryText,
                    customer: customer,
                    createdAt: Date.now()
                }));
            } catch (e) {}

            window.location.href = data.init_point;
        } catch (err) {
            console.error('Error iniciando pago Mercado Pago:', err);
            showToast('Error de conexión con Mercado Pago. Probá por WhatsApp.', 'fa-triangle-exclamation');
            alert('No pudimos conectar con Mercado Pago en este momento. Podés enviar tu pedido por WhatsApp sin problema.');
        } finally {
            if (mpBtn) {
                mpBtn.disabled = false;
                mpBtn.innerHTML = origHtml;
            }
        }
    }

    function checkMercadoPagoReturn() {
        const params = new URLSearchParams(window.location.search);
        const status = params.get('pago');
        if (!status) return;

        const orderRef = params.get('orden') || params.get('external_reference') || '';
        const paymentId = params.get('payment_id') || params.get('collection_id') || '';

        let pendingOrder = null;
        try {
            const raw = localStorage.getItem('b25_pending_mp_order');
            if (raw) pendingOrder = JSON.parse(raw);
        } catch (e) {}

        const modal = document.getElementById('mpResultModal');
        const iconEl = document.getElementById('mpResultIcon');
        const titleEl = document.getElementById('mpResultTitle');
        const msgEl = document.getElementById('mpResultMessage');
        const metaEl = document.getElementById('mpResultMeta');
        const waBtn = document.getElementById('mpConfirmWhatsappBtn');

        if (!modal) return;

        if (status === 'aprobado') {
            if (iconEl) {
                iconEl.className = 'mp-result-icon success';
                iconEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            }
            if (titleEl) titleEl.textContent = '¡Pago Aprobado!';
            if (msgEl) msgEl.textContent = 'Recibimos tu pago en Mercado Pago. Tocá el botón de abajo para avisarnos por WhatsApp y coordinar la entrega al instante.';
            // Vaciar carrito tras pago confirmado
            state.cart = [];
            saveCartToStorage();
        } else if (status === 'pendiente') {
            if (iconEl) {
                iconEl.className = 'mp-result-icon pending';
                iconEl.innerHTML = '<i class="fa-solid fa-clock"></i>';
            }
            if (titleEl) titleEl.textContent = 'Pago Pendiente';
            if (msgEl) msgEl.textContent = 'Tu pago está en proceso de acreditación en Mercado Pago. Escribinos por WhatsApp para reservar tu pedido.';
        } else {
            if (iconEl) {
                iconEl.className = 'mp-result-icon failure';
                iconEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
            }
            if (titleEl) titleEl.textContent = 'Pago No Completado';
            if (msgEl) msgEl.textContent = 'El pago fue cancelado o rechazado. Tu carrito sigue guardado: podés volver a intentar o pedir en efectivo por WhatsApp.';
        }

        if (metaEl) {
            const parts = [];
            if (orderRef) parts.push(`Orden: ${orderRef}`);
            if (paymentId) parts.push(`Operación MP: #${paymentId}`);
            if (pendingOrder && pendingOrder.total) parts.push(`Total: ${formatCurrency(pendingOrder.total)}`);
            metaEl.textContent = parts.join(' · ') || 'Bebidas 25 de Mayo · Lanús Oeste';
        }

        if (waBtn) {
            waBtn.onclick = () => {
                const phone = state.config.whatsapp_phone || '5491176265350';
                const statusLabel = status === 'aprobado'
                    ? '✅ *PAGO APROBADO POR MERCADO PAGO*'
                    : (status === 'pendiente' ? '⏳ *PAGO PENDIENTE EN MERCADO PAGO*' : '💬 *CONSULTA SOBRE PEDIDO WEB*');
                const header = `${statusLabel}\n${orderRef ? `🔖 *Orden:* ${orderRef}\n` : ''}${paymentId ? `🧾 *Operación MP:* #${paymentId}\n` : ''}\n`;
                const baseMsg = (pendingOrder && pendingOrder.summaryText)
                    ? pendingOrder.summaryText
                    : 'Hola Bebidas 25 de Mayo, acabo de realizar un pago en la tienda web.';
                window.open(`https://wa.me/${phone}?text=${encodeURIComponent(header + baseMsg)}`, '_blank', 'noopener');
            };
        }

        modal.style.display = 'flex';
        if (status === 'aprobado') {
            try { localStorage.removeItem('b25_pending_mp_order'); } catch (e) {}
        }

        // Limpiar parámetros de la URL sin recargar
        try {
            window.history.replaceState({}, '', window.location.pathname);
        } catch (e) {}
    }

    function closeMpResultModal() {
        const modal = document.getElementById('mpResultModal');
        if (modal) modal.style.display = 'none';
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
                if (state.activeDetail) closeItemDetail(true);
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

        const btnMp = document.getElementById('payMercadoPagoBtn');
        const btnWhatsapp = document.getElementById('sendWhatsappOrderBtn');
        const btnEmail = document.getElementById('sendEmailOrderBtn');
        const paymentSel = document.getElementById('paymentMethod');
        if (btnMp) btnMp.addEventListener('click', payWithMercadoPago);
        if (btnWhatsapp) btnWhatsapp.addEventListener('click', sendWhatsappOrder);
        if (btnEmail) btnEmail.addEventListener('click', sendEmailOrder);
        if (paymentSel) {
            paymentSel.addEventListener('change', updatePaymentModeUI);
            updatePaymentModeUI();
        }

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
                    const r1 = await fetch(`/api/public/${name}.json${bust}`);
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

            // Si el usuario ingresó por URL directa (/producto/<slug> o /combo/<slug>), abrir su vista
            syncRouteFromLocation();
            // Si vuelve de Mercado Pago (?pago=aprobado|pendiente|rechazado), mostrar confirmación
            checkMercadoPagoReturn();

        } catch (err) {
            console.error('Error cargando catálogo público:', err);
            showToast('Error de conexión al cargar el catálogo', 'fa-triangle-exclamation');
        }
    }

    // ----------------- VISTA DEDICADA + ROUTER POR URL (/producto/<slug> y /combo/<slug>) -----------------
    const DEFAULT_PAGE_TITLE = 'Bebidas 25 de Mayo | Tienda Online Mayorista y Minorista';

    function setCatalogSectionsVisible(visible) {
        const ids = ['heroCarouselSection', 'combosSection', 'catalogSection'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? '' : 'none';
        });
        const trust = document.querySelector('.trust-banner-section');
        const mainCatalog = document.querySelector('.products-catalog-section');
        if (trust) trust.style.display = visible ? '' : 'none';
        if (mainCatalog) mainCatalog.style.display = visible ? '' : 'none';
    }

    function openItemDetail(type, item, pushHistory = true) {
        const section = document.getElementById('itemDetailSection');
        const container = document.getElementById('itemDetailContainer');
        if (!section || !container || !item) return;

        state.activeDetail = { type, id: item.id };
        const isCombo = type === 'combo';
        const imgUrl = getAbsoluteImg(item.image_path);
        const itemPath = getItemPath(type, item);
        const fullUrl = `${window.location.origin}${itemPath}`;

        if (pushHistory && window.location.pathname !== itemPath) {
            try {
                window.history.pushState({ detailType: type, detailId: item.id }, '', itemPath);
            } catch (e) {}
        }

        const priceLabel = isCombo ? formatCurrency(item.price) : formatCurrency(item.price_minorista);
        document.title = `${item.name} — ${priceLabel} | Bebidas 25 de Mayo`;

        const inCartQty = getCartQtyForItem(item.id, type);
        const isOut = !isCombo && item.is_out_of_stock;

        let pricingHtml = '';
        if (isCombo) {
            const oldHtml = (item.regular_price && item.regular_price > item.price)
                ? `<span class="detail-old-price">Antes ${formatCurrency(item.regular_price)}</span>`
                : '';
            pricingHtml = `
                <div class="detail-price-box mayorista">
                    <span class="detail-price-label">🔥 Precio Promo Combo</span>
                    <div class="detail-price-value">${formatCurrency(item.price)} ${oldHtml}</div>
                </div>
            `;
        } else {
            const pMay = item.price_mayorista || item.price_minorista;
            pricingHtml = `
                <div class="detail-price-box">
                    <span class="detail-price-label">Precio Minorista (x unidad)</span>
                    <div class="detail-price-value">${formatCurrency(item.price_minorista)}</div>
                </div>
                <div class="detail-price-box mayorista">
                    <span class="detail-price-label">Precio Mayorista (compras &gt;$100.000)</span>
                    <div class="detail-price-value">${formatCurrency(pMay)}</div>
                </div>
            `;
        }

        const comboItemsHtml = (isCombo && item.items && item.items.length)
            ? `<ul class="detail-combo-list">${item.items.map(it => `<li><i class="fa-solid fa-check"></i> ${it.qty}x ${it.name}</li>`).join('')}</ul>`
            : '';

        const stageBadge = isCombo
            ? (item.badge ? `<span class="detail-stage-badge">${item.badge}</span>` : '<span class="detail-stage-badge">🔥 COMBO ESPECIAL</span>')
            : (isOut ? '<span class="detail-stage-badge">AGOTADO</span>' : (item.is_featured ? '<span class="detail-stage-badge">⭐ DESTACADO</span>' : ''));

        // Relacionados (4 del mismo rubro o 4 combos)
        let relatedItems = [];
        if (isCombo) {
            relatedItems = state.combos.filter(c => c.id !== item.id).slice(0, 4).map(c => ({
                type: 'combo', id: c.id, name: c.name, price: c.price, image: getAbsoluteImg(c.image_path), href: getItemPath('combo', c)
            }));
        } else {
            relatedItems = state.products
                .filter(p => p.id !== item.id && String(p.category_id) === String(item.category_id) && (!p.category_name || p.category_name.toUpperCase() !== 'COMBOS'))
                .slice(0, 4)
                .map(p => ({
                    type: 'product', id: p.id, name: p.name, price: p.price_minorista, image: getAbsoluteImg(p.image_path), href: getItemPath('product', p)
                }));
        }

        const relatedHtml = relatedItems.length ? `
            <div class="detail-related-block">
                <h2 class="detail-related-title">También te puede interesar</h2>
                <div class="detail-related-grid">
                    ${relatedItems.map(r => `
                        <a href="${r.href}" class="related-mini-card" onclick="event.preventDefault(); tiendaApp.openItemById('${r.type}', ${r.id});">
                            <div class="related-mini-img">
                                <img src="${r.image}" onerror="this.src='/uploads/logo.jpg'" alt="${r.name}" loading="lazy">
                            </div>
                            <div class="related-mini-name">${r.name}</div>
                            <div class="related-mini-price">${formatCurrency(r.price)}</div>
                        </a>
                    `).join('')}
                </div>
            </div>
        ` : '';

        container.innerHTML = `
            <div class="detail-breadcrumb">
                <button type="button" class="btn-back-catalog" onclick="tiendaApp.closeItemDetail()">
                    <i class="fa-solid fa-arrow-left"></i> Volver al catálogo
                </button>
                <span class="detail-crumb-path">${isCombo ? 'Combos Especiales' : (item.category_name || 'Catálogo')} / ${item.name}</span>
            </div>

            <div class="detail-main-card">
                <div class="detail-image-stage">
                    ${stageBadge}
                    <img src="${imgUrl}" onerror="this.src='/uploads/logo.jpg'" alt="${item.name}">
                </div>

                <div class="detail-info-col">
                    <span class="detail-cat-pill">${isCombo ? '🔥 COMBO PROMOCIONAL' : (item.category_name || 'BEBIDA')}</span>
                    <h1 class="detail-title">${item.name}</h1>
                    <p class="detail-subtitle">${isCombo ? (item.description || 'Combo armado listo para retirar o enviar por Lanús.') : (item.presentation || 'Unidad')}</p>
                    ${comboItemsHtml}

                    <div class="detail-prices-grid">
                        ${pricingHtml}
                    </div>

                    <div class="detail-buy-row">
                        <div class="quantity-stepper">
                            <button type="button" onclick="tiendaApp.stepDetailQty(-1)" aria-label="Restar">-</button>
                            <input type="number" id="detailQtyInput" value="1" min="1" max="99" readonly>
                            <button type="button" onclick="tiendaApp.stepDetailQty(1)" aria-label="Sumar">+</button>
                        </div>
                        <button type="button" class="btn-detail-add" onclick="tiendaApp.addDetailItemToCart()" ${isOut ? 'disabled' : ''}>
                            <i class="fa-solid fa-cart-plus"></i>
                            ${isOut ? 'Agotado' : (inCartQty > 0 ? `Sumar al Pedido (${inCartQty} en carrito)` : 'Agregar al Pedido')}
                        </button>
                    </div>

                    <div class="detail-share-bar">
                        <button type="button" class="btn-share-wa" onclick="tiendaApp.shareDetailWhatsapp()">
                            <i class="fa-brands fa-whatsapp"></i> Compartir por WhatsApp
                        </button>
                        <button type="button" class="btn-share-copy" onclick="tiendaApp.copyDetailLink()">
                            <i class="fa-solid fa-link"></i> Copiar enlace
                        </button>
                    </div>

                    <div class="detail-trust-note">
                        <span><i class="fa-solid fa-truck-fast"></i> Envíos por Lanús</span>
                        <span><i class="fa-solid fa-store"></i> Retiro en Av. 25 de Mayo 434</span>
                        <span><i class="fa-regular fa-clock"></i> Lun–Jue 10:30–21:30 · Vie–Sáb 10:30–00:00</span>
                    </div>
                </div>
            </div>

            ${relatedHtml}
        `;

        setCatalogSectionsVisible(false);
        section.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function closeItemDetail(pushHistory = true) {
        const section = document.getElementById('itemDetailSection');
        if (section) section.style.display = 'none';
        state.activeDetail = null;
        setCatalogSectionsVisible(true);
        document.title = DEFAULT_PAGE_TITLE;
        renderFilteredProducts();

        if (pushHistory && window.location.pathname !== '/' && window.location.pathname !== '/tienda') {
            try {
                window.history.pushState({}, '', '/');
            } catch (e) {}
        }
    }

    function syncRouteFromLocation() {
        const path = window.location.pathname.replace(/\/+$/, '');
        const comboMatch = path.match(/^\/combo\/([^/]+)$/);
        if (comboMatch) {
            const slug = decodeURIComponent(comboMatch[1]);
            const idMatch = slug.match(/-(\d+)$/);
            let found = idMatch ? state.combos.find(c => String(c.id) === idMatch[1]) : null;
            if (!found) found = state.combos.find(c => getComboSlug(c) === slug);
            if (found) {
                openItemDetail('combo', found, false);
                return;
            }
        }
        const prodMatch = path.match(/^\/producto\/([^/]+)$/);
        if (prodMatch) {
            const slug = decodeURIComponent(prodMatch[1]);
            const idMatch = slug.match(/-(\d+)$/);
            let found = idMatch ? state.products.find(p => String(p.id) === idMatch[1]) : null;
            if (!found) found = state.products.find(p => getProductSlug(p) === slug);
            if (found) {
                openItemDetail('product', found, false);
                return;
            }
        }
        if (state.activeDetail) {
            closeItemDetail(false);
        }
    }

    window.addEventListener('popstate', () => {
        syncRouteFromLocation();
    });

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
        const prodTrigger = e.target.closest('.product-image-container, .product-card .product-name');
        if (prodTrigger) {
            const card = prodTrigger.closest('.product-card');
            if (card) {
                const prodId = card.getAttribute('data-product-id');
                const prod = state.products.find(p => String(p.id) === String(prodId));
                if (prod) {
                    openItemDetail('product', prod, true);
                }
            }
            return;
        }

        const comboTrigger = e.target.closest('.combo-image-box, .combo-card .combo-name');
        if (comboTrigger) {
            const card = comboTrigger.closest('.combo-card');
            if (card) {
                const comboId = card.getAttribute('data-combo-id');
                let comboObj = comboId ? state.combos.find(c => String(c.id) === String(comboId)) : null;
                if (!comboObj) {
                    const titleEl = card.querySelector('.combo-name');
                    if (titleEl) {
                        const comboName = titleEl.innerText.trim().toLowerCase();
                        comboObj = state.combos.find(c => c.name.trim().toLowerCase() === comboName);
                    }
                }
                if (comboObj) {
                    openItemDetail('combo', comboObj, true);
                }
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
        setComboTab: function (tabId) {
            setComboTab(tabId);
        },
        resetFilters: function () {
            if (state.activeDetail) closeItemDetail(true);
            state.activeCategory = 'all';
            state.searchQuery = '';
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.style.display = 'none';
            renderCategories();
            renderFilteredProducts();
        },
        isDetailOpen: function () {
            return !!state.activeDetail;
        },
        closeItemDetail: function () {
            closeItemDetail(true);
        },
        openItemById: function (type, id) {
            const item = type === 'combo'
                ? state.combos.find(c => String(c.id) === String(id))
                : state.products.find(p => String(p.id) === String(id));
            if (item) openItemDetail(type, item, true);
        },
        stepDetailQty: function (delta) {
            const input = document.getElementById('detailQtyInput');
            if (!input) return;
            const next = Math.max(1, Math.min(99, (parseInt(input.value, 10) || 1) + delta));
            input.value = next;
        },
        addDetailItemToCart: function () {
            if (!state.activeDetail) return;
            const qtyInput = document.getElementById('detailQtyInput');
            const qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
            const { type, id } = state.activeDetail;
            if (type === 'combo') {
                const c = state.combos.find(x => String(x.id) === String(id));
                if (!c) return;
                addToCart({
                    id: c.id,
                    type: 'combo',
                    name: c.name,
                    presentation: c.description || 'Promo Pack',
                    price: c.price,
                    qty: qty,
                    image: c.image_path
                });
                openItemDetail('combo', c, false);
            } else {
                const p = state.products.find(x => String(x.id) === String(id));
                if (!p) return;
                addToCart({
                    id: p.id,
                    type: 'product',
                    name: p.name,
                    presentation: p.presentation,
                    price: p.price_minorista,
                    priceMinorista: p.price_minorista,
                    priceMayorista: p.price_mayorista || p.price_minorista,
                    qty: qty,
                    image: p.image_path
                });
                openItemDetail('product', p, false);
            }
        },
        copyDetailLink: async function () {
            const url = window.location.href;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(url);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = url;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                }
                showToast('¡Enlace copiado! Listo para compartir', 'fa-link');
            } catch (e) {
                showToast('Copiá el enlace desde la barra de direcciones', 'fa-link');
            }
        },
        shareDetailWhatsapp: function () {
            if (!state.activeDetail) return;
            const { type, id } = state.activeDetail;
            const item = type === 'combo'
                ? state.combos.find(c => String(c.id) === String(id))
                : state.products.find(p => String(p.id) === String(id));
            if (!item) return;
            const priceText = type === 'combo' ? formatCurrency(item.price) : formatCurrency(item.price_minorista);
            const url = window.location.href;
            const msg = `Mirá esta promo de Bebidas 25 de Mayo: *${item.name}* (${priceText}) 👇\n${url}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
        },
        closeMpResultModal: function () {
            closeMpResultModal();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
