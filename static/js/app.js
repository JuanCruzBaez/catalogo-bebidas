document.addEventListener('alpine:init', () => {
    Alpine.data('catalogApp', () => ({
        // Vistas principales: 'products' (Catálogo) o 'categories' (Página Administradora de Categorías)
        currentView: 'products',

        // Datos principales
        products: [],
        allProducts: [],
        categories: [],
        settings: {},
        isLoading: true,
        searchQuery: '',
        selectedCategory: 'all',
        filterStock: 'all', // 'all', 'in_stock', 'out_of_stock'
        viewMode: 'table', // 'table' o 'cards'
        sortBy: 'category', // 'category', 'name', 'price_asc', 'price_desc', 'stock_asc', 'stock_desc'

        // Modales
        showProductModal: false,
        showSettingsModal: false,
        showBulkPriceModal: false,
        showPdfPreviewModal: false,
        showClearDbModal: false,
        newAdminPassword: '',
        
        // Estado de Sincronización Local <-> Web
        isSyncing: false,
        lastSyncTime: localStorage.getItem('last_sync_time') || null,
        syncState: localStorage.getItem('last_sync_time') ? 'synced' : 'idle',
        
        // Estado del Módulo de Ventas (Punto de Venta)
        salesSubView: 'pos', // 'pos' o 'history'
        historySubTab: 'sales', // 'sales' (Listado de Ventas) o 'profits' (Balance de Utilidades y Ganancias)
        salesPeriod: 'today', // 'today', 'week', 'month', 'year', 'historical'
        salesDateFilter: '',
        salesSellerFilter: '',
        sellerName: localStorage.getItem('pos_seller_name') || '',
        salesPriceType: 'minorista', // 'minorista' o 'mayorista'
        salesSearchQuery: '',
        salesCategory: 'all',
        cart: [],
        paymentMethod: 'Efectivo',
        cashReceived: '', // Dinero con el que abona el cliente
        saleNotes: '',
        salesHistory: [],
        salesSummary: { 
            today: { total: 0, cost: 0, profit: 0, margin_pct: 0, count: 0, items: 0, average: 0, total_today: 0, count_today: 0, items_today: 0 }, 
            yesterday: { total: 0, cost: 0, profit: 0, margin_pct: 0, count: 0, items: 0, average: 0 },
            week: { total: 0, cost: 0, profit: 0, margin_pct: 0, count: 0, items: 0, average: 0 },
            month: { total: 0, cost: 0, profit: 0, margin_pct: 0, count: 0, items: 0, average: 0 },
            year: { total: 0, cost: 0, profit: 0, margin_pct: 0, count: 0, items: 0, average: 0 },
            historical: { total: 0, cost: 0, profit: 0, margin_pct: 0, count: 0, items: 0, average: 0, total_all: 0, count_all: 0, profit_all: 0 },
            custom_date: null,
            custom_month: null
        },
        // Estado del Balance de Utilidades / Ganancias
        profitPeriod: 'month', // 'today', 'yesterday', 'week', 'month', 'year', 'historical', 'custom_month', 'custom_date'
        selectedProfitMonth: '',
        selectedProfitDate: '',
        profitBreakdown: { totals: { total_revenue: 0, total_cost: 0, total_profit: 0, margin_pct: 0, total_items: 0, total_sales: 0 }, products: [] },
        isLoadingProfit: false,
        selectedSaleDetail: null,
        isSavingSaleDetail: false,
        showSaleDetailModal: false,
        showSaleSuccessModal: false,
        lastCompletedSale: null,
        isSubmittingSale: false,
        
        // Modal de reasignación de productos entre categorías
        showReassignModal: false,
        reassignData: {
            fromCategory: null,
            targetCategoryId: ''
        },

        // Modal de eliminación de categoría
        showDeleteCategoryModal: false,
        categoryToDelete: null,
        deleteCategoryAction: 'reassign', // 'reassign' o 'delete_products'
        deleteReassignTargetId: '',

        settingsTab: 'textos', // 'textos', 'contacto', 'logo', 'mantenimiento'
        
        // Estado del producto en edición / creación
        editingProduct: {
            id: null,
            name: '',
            category_id: '',
            presentation: '',
            price_minorista: 0,
            price_mayorista: 0,
            cost_price: 0,
            supplier: '',
            stock: 10,
            image_path: '',
            is_active: 1,
            is_featured: 0
        },
        imageFile: null,
        imagePreview: '',

        // Estado de vaciado de base de datos
        clearConfirmationText: '',
        isClearingDb: false,

        // Estado del modal de ajuste masivo
        bulkAdjustment: {
            category_id: 'all',
            percentage: 10,
            price_type: 'both' // 'minorista', 'mayorista', 'both'
        },

        // Nueva categoría
        newCategoryName: '',
        editingCategoryId: null,
        editingCategoryName: '',

        // Estado de previsualización PDF
        pdfPreviewUrl: '',
        pdfPreviewType: 'minorista', // 'minorista' o 'mayorista'
        pdfPreviewStyle: 'cards',

        // Notificaciones Toast
        toast: {
            show: false,
            message: '',
            type: 'success' // 'success', 'error', 'info'
        },

        // Inicialización
        async init() {
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            this.selectedProfitMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
            this.selectedProfitDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

            await this.fetchSettings();
            await this.fetchCategories();
            await this.fetchProducts();
            await this.fetchSalesSummary();
            await this.fetchProfitBreakdown();
            this.isLoading = false;

            // Sincronización automática silenciosa si estamos en entorno local
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            if (isLocal) {
                setTimeout(() => this.silentSync(), 2500);
                setInterval(() => this.silentSync(), 45000);
            }
        },

        showToast(message, type = 'success') {
            this.toast.message = message;
            this.toast.type = type;
            this.toast.show = true;
            setTimeout(() => {
                this.toast.show = false;
            }, 3500);
        },

        // Carga de datos
        async fetchSettings() {
            try {
                const res = await fetch('/api/settings');
                this.settings = await res.json();
            } catch (err) {
                console.error("Error al cargar configuración:", err);
            }
        },

        async fetchCategories() {
            try {
                const res = await fetch('/api/categories');
                this.categories = await res.json();
            } catch (err) {
                console.error("Error al cargar categorías:", err);
            }
        },

        async fetchProducts() {
            try {
                // Siempre cargamos la lista completa en allProducts para mantener el Punto de Venta desacoplado
                const resAll = await fetch('/api/products');
                this.allProducts = await resAll.json();

                // Para la pestaña de Gestión de Productos, filtramos localmente sin afectar a Caja / POS:
                let list = [...this.allProducts];
                if (this.selectedCategory !== 'all') {
                    list = list.filter(p => p.category_id == this.selectedCategory);
                }
                if (this.searchQuery && this.searchQuery.trim()) {
                    const q = this.searchQuery.toLowerCase().trim();
                    list = list.filter(p => 
                        (p.name && p.name.toLowerCase().includes(q)) ||
                        (p.presentation && p.presentation.toLowerCase().includes(q)) ||
                        (p.category_name && p.category_name.toLowerCase().includes(q))
                    );
                }
                this.products = list;
            } catch (err) {
                console.error("Error al cargar productos:", err);
            }
        },

        // Métricas calculadas sobre el total del inventario
        get totalProductsCount() {
            return (this.allProducts && this.allProducts.length > 0 ? this.allProducts : this.products).length;
        },

        get activeProductsCount() {
            const list = (this.allProducts && this.allProducts.length > 0 ? this.allProducts : this.products);
            return list.filter(p => p.is_active === 1 && (p.stock || 0) > 0).length;
        },

        get outOfStockCount() {
            const list = (this.allProducts && this.allProducts.length > 0 ? this.allProducts : this.products);
            return list.filter(p => (p.stock || 0) <= 0).length;
        },

        get totalCategoriesCount() {
            return this.categories.length;
        },

        get categoriesWithProductsCount() {
            return this.categories.filter(c => (c.product_count || 0) > 0).length;
        },

        get filteredAndSortedProducts() {
            let list = [...this.products];
            
            // Filtro por stock
            if (this.filterStock === 'in_stock') {
                list = list.filter(p => (p.stock || 0) > 0);
            } else if (this.filterStock === 'out_of_stock') {
                list = list.filter(p => (p.stock || 0) <= 0);
            }

            // Ordenamiento
            if (this.sortBy === 'name') {
                list.sort((a, b) => a.name.localeCompare(b.name));
            } else if (this.sortBy === 'price_asc') {
                list.sort((a, b) => a.price_minorista - b.price_minorista);
            } else if (this.sortBy === 'price_desc') {
                list.sort((a, b) => b.price_minorista - a.price_minorista);
            } else if (this.sortBy === 'stock_asc') {
                list.sort((a, b) => (a.stock || 0) - (b.stock || 0));
            } else if (this.sortBy === 'stock_desc') {
                list.sort((a, b) => (b.stock || 0) - (a.stock || 0));
            } else if (this.sortBy === 'category') {
                list.sort((a, b) => {
                    if (a.category_name === b.category_name) {
                        return a.name.localeCompare(b.name);
                    }
                    return (a.category_name || '').localeCompare(b.category_name || '');
                });
            }
            return list;
        },

        formatMoney(amount) {
            if (amount === undefined || amount === null || isNaN(amount)) return '$ 0';
            const num = Number(amount);
            const symbol = this.settings.currency_symbol || '$';
            return `${symbol} ${num.toLocaleString('es-AR')}`;
        },

        // Alias de formatMoney usado en la sección de ventas (Punto de Venta e Historial)
        formatCurrency(amount) {
            return this.formatMoney(amount);
        },

        // Cálculo de utilidad neta y margen porcentual
        getProductProfit(price, cost) {
            const p = Number(price || 0);
            const c = Number(cost || 0);
            if (c <= 0 || p <= 0) return { profit: 0, margin: 0, isNegative: false, hasCost: c > 0 };
            const profit = p - c;
            const margin = Math.round((profit / p) * 1000) / 10;
            return {
                profit: profit,
                margin: margin,
                isNegative: profit < 0,
                hasCost: true
            };
        },

        // Navegación rápida
        viewCategoryProducts(catId) {
            this.selectedCategory = catId;
            this.currentView = 'products';
            this.fetchProducts();
        },

        // Gestión de Productos
        openNewProductModal() {
            const firstCat = this.categories.length > 0 ? this.categories[0].id : '';
            this.editingProduct = {
                id: null,
                name: '',
                category_id: firstCat,
                presentation: '',
                price_minorista: 0,
                price_mayorista: 0,
                cost_price: 0,
                supplier: '',
                stock: 10,
                image_path: '',
                is_active: 1,
                is_featured: 0
            };
            this.imageFile = null;
            this.imagePreview = '';
            this.showProductModal = true;
        },

        openEditProductModal(prod) {
            this.editingProduct = { 
                ...prod, 
                cost_price: prod.cost_price !== undefined ? prod.cost_price : 0,
                supplier: prod.supplier || '',
                stock: prod.stock !== undefined ? prod.stock : 10 
            };
            this.imageFile = null;
            this.imagePreview = prod.image_path ? `/${prod.image_path}` : '';
            this.showProductModal = true;
        },

        handleImageSelect(event) {
            const file = event.target.files[0];
            if (file) {
                this.imageFile = file;
                this.imagePreview = URL.createObjectURL(file);
            }
        },

        async saveProduct() {
            if (!this.editingProduct.name.trim()) {
                this.showToast("El nombre del producto es requerido", "error");
                return;
            }
            if (!this.editingProduct.category_id) {
                this.showToast("Debes seleccionar una categoría", "error");
                return;
            }

            const formData = new FormData();
            formData.append('name', this.editingProduct.name);
            formData.append('category_id', this.editingProduct.category_id);
            formData.append('presentation', this.editingProduct.presentation || '');
            formData.append('price_minorista', this.editingProduct.price_minorista || 0);
            formData.append('price_mayorista', this.editingProduct.price_mayorista || 0);
            formData.append('cost_price', this.editingProduct.cost_price || 0);
            formData.append('supplier', this.editingProduct.supplier || '');
            formData.append('stock', this.editingProduct.stock !== undefined ? this.editingProduct.stock : 10);
            formData.append('is_active', this.editingProduct.is_active);
            formData.append('is_featured', this.editingProduct.is_featured);

            if (this.imageFile) {
                formData.append('image', this.imageFile);
            }

            try {
                let res;
                if (this.editingProduct.id) {
                    res = await fetch(`/api/products/${this.editingProduct.id}`, {
                        method: 'PUT',
                        body: formData
                    });
                } else {
                    res = await fetch('/api/products', {
                        method: 'POST',
                        body: formData
                    });
                }

                if (res.ok) {
                    this.showToast(this.editingProduct.id ? "Producto actualizado con éxito" : "Producto creado con éxito");
                    this.showProductModal = false;
                    await this.fetchProducts();
                    await this.fetchCategories();
                } else {
                    this.showToast("Ocurrió un error al guardar el producto", "error");
                }
            } catch (err) {
                console.error(err);
                this.showToast("Error de conexión al servidor", "error");
            }
        },

        async quickUpdateStock(prod, delta) {
            const currentStock = prod.stock !== undefined ? prod.stock : 10;
            const newStock = Math.max(0, currentStock + delta);
            try {
                const res = await fetch(`/api/products/${prod.id}/stock`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stock: newStock })
                });
                if (res.ok) {
                    prod.stock = newStock;
                    if (newStock === 0) {
                        this.showToast(`"${prod.name}" marcado como AGOTADO`, "info");
                    }
                }
            } catch (err) {
                this.showToast("Error al actualizar stock", "error");
            }
        },

        async deleteProduct(prod) {
            if (confirm(`¿Estás seguro de eliminar "${prod.name}" del catálogo?`)) {
                try {
                    const res = await fetch(`/api/products/${prod.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        this.showToast("Producto eliminado", "info");
                        await this.fetchProducts();
                        await this.fetchCategories();
                    }
                } catch (err) {
                    this.showToast("Error al eliminar producto", "error");
                }
            }
        },

        async duplicateProduct(prod) {
            try {
                const res = await fetch(`/api/products/${prod.id}/duplicate`, { method: 'POST' });
                if (res.ok) {
                    this.showToast("Producto duplicado exitosamente");
                    await this.fetchProducts();
                    await this.fetchCategories();
                }
            } catch (err) {
                this.showToast("Error al duplicar producto", "error");
            }
        },

        async toggleProductActive(prod) {
            try {
                const res = await fetch(`/api/products/${prod.id}/toggle-active`, { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    prod.is_active = data.is_active;
                    this.showToast(data.is_active ? "Producto visible en catálogo" : "Producto ocultado", "info");
                }
            } catch (err) {
                this.showToast("Error al cambiar estado", "error");
            }
        },

        // ==========================================
        // GESTOR DE CATEGORÍAS (PÁGINA DEDICADA)
        // ==========================================

        async addCategory() {
            const name = this.newCategoryName.trim();
            if (!name) {
                this.showToast("Ingresa un nombre para la nueva categoría", "error");
                return;
            }

            try {
                const res = await fetch('/api/categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name.toUpperCase() })
                });

                if (res.ok) {
                    this.newCategoryName = '';
                    this.showToast(`Categoría "${name.toUpperCase()}" creada con éxito`);
                    await this.fetchCategories();
                    await this.fetchProducts();
                } else {
                    this.showToast("Error al crear la categoría", "error");
                }
            } catch (err) {
                this.showToast("Error al conectar con el servidor", "error");
            }
        },

        startEditingCategory(cat) {
            this.editingCategoryId = cat.id;
            this.editingCategoryName = cat.name;
        },

        async saveCategoryName(cat) {
            const newName = this.editingCategoryName.trim();
            if (!newName) {
                this.showToast("El nombre de la categoría no puede estar vacío", "error");
                return;
            }

            try {
                const res = await fetch(`/api/categories/${cat.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        name: newName.toUpperCase(),
                        order_index: cat.order_index 
                    })
                });

                if (res.ok) {
                    cat.name = newName.toUpperCase();
                    this.editingCategoryId = null;
                    this.showToast(`Categoría actualizada a "${cat.name}". Todos sus productos han sido actualizados.`);
                    await this.fetchCategories();
                    await this.fetchProducts();
                } else {
                    this.showToast("Error al actualizar categoría", "error");
                }
            } catch (err) {
                this.showToast("Error al conectar con el servidor", "error");
            }
        },

        cancelEditingCategory() {
            this.editingCategoryId = null;
            this.editingCategoryName = '';
        },

        async swapCategoryOrder(cat, direction) {
            try {
                const res = await fetch(`/api/categories/${cat.id}/swap-order`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ direction })
                });

                if (res.ok) {
                    await this.fetchCategories();
                    await this.fetchProducts();
                }
            } catch (err) {
                this.showToast("Error al cambiar orden", "error");
            }
        },

        openReassignModal(cat) {
            this.reassignData.fromCategory = cat;
            const otherCats = this.categories.filter(c => c.id !== cat.id);
            this.reassignData.targetCategoryId = otherCats.length > 0 ? otherCats[0].id : '';
            this.showReassignModal = true;
        },

        async confirmReassignProducts() {
            if (!this.reassignData.targetCategoryId) {
                this.showToast("Selecciona la categoría destino", "error");
                return;
            }

            try {
                const res = await fetch(`/api/categories/${this.reassignData.fromCategory.id}/reassign`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to_category_id: this.reassignData.targetCategoryId })
                });

                const data = await res.json();
                if (res.ok) {
                    this.showToast(data.message || "Productos transferidos con éxito");
                    this.showReassignModal = false;
                    await this.fetchCategories();
                    await this.fetchProducts();
                } else {
                    this.showToast(data.error || "Error al mover productos", "error");
                }
            } catch (err) {
                this.showToast("Error al conectar con el servidor", "error");
            }
        },

        openDeleteCategoryModal(cat) {
            this.categoryToDelete = cat;
            const otherCats = this.categories.filter(c => c.id !== cat.id);
            this.deleteCategoryAction = otherCats.length > 0 ? 'reassign' : 'delete_products';
            this.deleteReassignTargetId = otherCats.length > 0 ? otherCats[0].id : '';
            this.showDeleteCategoryModal = true;
        },

        async confirmDeleteCategory() {
            if (!this.categoryToDelete) return;

            let url = `/api/categories/${this.categoryToDelete.id}`;
            if (this.deleteCategoryAction === 'reassign' && this.deleteReassignTargetId) {
                url += `?reassign_to_id=${this.deleteReassignTargetId}`;
            }

            try {
                const res = await fetch(url, { method: 'DELETE' });
                if (res.ok) {
                    this.showToast(`Categoría "${this.categoryToDelete.name}" eliminada`);
                    this.showDeleteCategoryModal = false;
                    this.categoryToDelete = null;
                    await this.fetchCategories();
                    await this.fetchProducts();
                } else {
                    this.showToast("Error al eliminar categoría", "error");
                }
            } catch (err) {
                this.showToast("Error al conectar con el servidor", "error");
            }
        },

        // Ajuste Masivo de Precios
        async applyBulkPriceAdjustment() {
            const pct = parseFloat(this.bulkAdjustment.percentage);
            if (isNaN(pct) || pct === 0) {
                this.showToast("Ingresa un porcentaje válido diferente de cero", "error");
                return;
            }

            const catText = this.bulkAdjustment.category_id === 'all' ? 'todos los productos' : 'la categoría seleccionada';
            const sign = pct > 0 ? `aumento de +${pct}%` : `descuento de ${pct}%`;

            if (!confirm(`¿Confirmas aplicar un ${sign} a ${catText}?`)) {
                return;
            }

            try {
                const res = await fetch('/api/products/bulk-price-adjustment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.bulkAdjustment)
                });

                if (res.ok) {
                    this.showToast(`Precios actualizados con éxito (${sign})`);
                    this.showBulkPriceModal = false;
                    await this.fetchProducts();
                }
            } catch (err) {
                this.showToast("Error al aplicar ajuste de precios", "error");
            }
        },

        // Configuración y Logo
        async saveSettings() {
            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.settings)
                });

                if (res.ok) {
                    this.showToast("Configuración guardada exitosamente");
                    this.showSettingsModal = false;
                    await this.fetchSettings();
                }
            } catch (err) {
                this.showToast("Error al guardar la configuración", "error");
            }
        },

        async uploadLogo(event) {
            const file = event.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('logo', file);

            try {
                const res = await fetch('/api/settings/upload-logo', {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    const data = await res.json();
                    this.settings.logo_path = data.logo_path;
                    this.showToast("Logo de la empresa actualizado");
                } else {
                    this.showToast("Error al subir el logo", "error");
                }
            } catch (err) {
                this.showToast("Error al procesar el archivo", "error");
            }
        },

        async changeAdminPassword() {
            if (!this.newAdminPassword || this.newAdminPassword.trim().length < 4) {
                this.showToast("La contraseña debe tener al menos 4 caracteres", "error");
                return;
            }
            try {
                const res = await fetch('/api/admin/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ new_password: this.newAdminPassword.trim() })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    this.showToast("¡Contraseña de administrador actualizada con éxito!");
                    this.newAdminPassword = '';
                } else {
                    this.showToast(data.error || "Error al cambiar contraseña", "error");
                }
            } catch (e) {
                this.showToast("Error de conexión al cambiar la contraseña", "error");
            }
        },

        // Vaciado de base de datos con doble confirmación
        openClearDatabaseModal() {
            this.clearConfirmationText = '';
            this.showClearDbModal = true;
        },

        async confirmClearDatabase() {
            if (this.clearConfirmationText.trim().toUpperCase() !== 'BORRAR') {
                this.showToast("Debes escribir la palabra BORRAR para confirmar", "error");
                return;
            }

            this.isClearingDb = true;
            try {
                const res = await fetch('/api/database/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirmation: 'BORRAR' })
                });

                if (res.ok) {
                    this.showToast("Productos eliminados correctamente (las categorías se mantienen)", "info");
                    this.showClearDbModal = false;
                    this.showSettingsModal = false;
                    await this.fetchCategories();
                    await this.fetchProducts();
                } else {
                    const data = await res.json();
                    this.showToast(data.error || "Error al vaciar productos", "error");
                }
            } catch (err) {
                this.showToast("Error de conexión con el servidor", "error");
            } finally {
                this.isClearingDb = false;
            }
        },

        async restoreSampleData() {
            if (confirm("¿Deseas restaurar los 95 productos y 11 categorías de ejemplo iniciales?")) {
                try {
                    const res = await fetch('/api/database/restore-sample', { method: 'POST' });
                    if (res.ok) {
                        this.showToast("Productos de ejemplo restaurados exitosamente");
                        this.showClearDbModal = false;
                        await this.fetchCategories();
                        await this.fetchProducts();
                    }
                } catch (err) {
                    this.showToast("Error al restaurar datos de ejemplo", "error");
                }
            }
        },

        // Exportación y Previsualización PDF
        exportPdf(type, download = true) {
            const url = `/api/export-pdf/${type}?preview=${!download}&t=${Date.now()}`;
            if (download) {
                window.open(url, '_blank');
                this.showToast(`Descargando PDF ${type === 'mayorista' ? 'Mayorista' : 'Minorista'}...`);
            } else {
                this.pdfPreviewType = type;
                this.pdfPreviewUrl = url;
                this.showPdfPreviewModal = true;
            }
        },

        // Importación CSV
        async importCsv(event) {
            const file = event.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            try {
                const res = await fetch('/api/backup/import-csv', {
                    method: 'POST',
                    body: formData
                });

                const data = await res.json();
                if (res.ok) {
                    this.showToast(`Se importaron ${data.imported_count} productos con éxito`);
                    this.showImportModal = false;
                    await this.fetchCategories();
                    await this.fetchProducts();
                } else {
                    this.showToast(data.error || "Error al importar archivo CSV", "error");
                }
            } catch (err) {
                this.showToast("Error al enviar archivo", "error");
            }
            event.target.value = '';
        },

        // ==========================================
        // MÓDULO DE GESTIÓN DE VENTAS (PUNTO DE VENTA)
        // ==========================================

        get paymentSurchargePct() {
            if (this.paymentMethod === 'Tarjeta de Débito') return 2;
            if (this.paymentMethod === 'Tarjeta de Crédito') return 7;
            if (this.paymentMethod === 'QR mercadopago') return 1;
            return 0;
        },

        get cartSubtotal() {
            return this.cart.reduce((sum, it) => sum + (it.unit_price * it.quantity), 0);
        },

        get cartSurchargeAmount() {
            const sub = this.cartSubtotal;
            const pct = this.paymentSurchargePct;
            if (pct <= 0 || sub <= 0) return 0;
            return Math.round(sub * (pct / 100));
        },

        get cartTotal() {
            return this.cartSubtotal + this.cartSurchargeAmount;
        },

        get cartTotalItems() {
            return this.cart.reduce((sum, it) => sum + it.quantity, 0);
        },

        // Cálculo de Vuelto para cobro en Efectivo
        get cashChange() {
            const paid = parseFloat(this.cashReceived) || 0;
            const total = this.cartTotal;
            if (paid <= 0 || paid < total) return 0;
            return Math.round((paid - total) * 100) / 100;
        },

        get isCashInsufficient() {
            const paid = parseFloat(this.cashReceived) || 0;
            return paid > 0 && paid < this.cartTotal;
        },

        get suggestedCashBills() {
            const t = this.cartTotal;
            if (t <= 0) return [1000, 2000, 5000, 10000, 20000];
            const standardBills = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
            const higherBills = standardBills.filter(b => b > t).slice(0, 3);
            const list = [];
            
            // Si el monto no es múltiplo de 1000, sugerir el siguiente redondeo a 1000
            const next1000 = Math.ceil(t / 1000) * 1000;
            if (next1000 > t && !higherBills.includes(next1000)) {
                list.push(next1000);
            }

            // Siguiente múltiplo de 5000 si aplica
            const next5000 = Math.ceil(t / 5000) * 5000;
            if (next5000 > t && !higherBills.includes(next5000) && !list.includes(next5000)) {
                list.push(next5000);
            }

            list.push(...higherBills);
            return list.sort((a, b) => a - b).slice(0, 3);
        },

        setExactCash() {
            this.cashReceived = this.cartTotal > 0 ? this.cartTotal : '';
        },

        setCashReceived(amount) {
            this.cashReceived = amount;
        },

        addCashReceived(amount) {
            const cur = parseFloat(this.cashReceived) || 0;
            this.cashReceived = cur + amount;
        },

        clearCashReceived() {
            this.cashReceived = '';
        },

        get currentPeriodSummary() {
            if (!this.salesSummary) return { total: 0, count: 0, items: 0, average: 0 };
            return this.salesSummary[this.salesPeriod] || { total: 0, count: 0, items: 0, average: 0 };
        },

        get currentPeriodLabel() {
            switch(this.salesPeriod) {
                case 'today': return 'Hoy';
                case 'week': return 'Esta Semana';
                case 'month': return 'Este Mes';
                case 'year': return 'Este Año';
                case 'historical': return 'Histórico Total';
                default: return 'Período';
            }
        },

        todayDateString() {
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        },

        yesterdayDateString() {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        },

        formatDateHuman(dateStr) {
            if (!dateStr) return '';
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            return dateStr;
        },

        get filteredSalesTotal() {
            return this.salesHistory.reduce((sum, s) => s.status === 'completed' ? sum + Number(s.total_amount || 0) : sum, 0);
        },

        get filteredSalesItems() {
            return this.salesHistory.reduce((sum, s) => s.status === 'completed' ? sum + Number(s.total_items || 0) : sum, 0);
        },

        get filteredSalesProfit() {
            return this.salesHistory.reduce((sum, s) => s.status === 'completed' ? sum + Number(s.total_profit || 0) : sum, 0);
        },

        get salesFilteredProducts() {
            const source = (this.allProducts && this.allProducts.length > 0) ? this.allProducts : this.products;
            let list = [...source];
            if (this.salesCategory !== 'all') {
                list = list.filter(p => p.category_id == this.salesCategory);
            }
            if (this.salesSearchQuery && this.salesSearchQuery.trim()) {
                const q = this.salesSearchQuery.toLowerCase().trim();
                list = list.filter(p => 
                    (p.name && p.name.toLowerCase().includes(q)) || 
                    (p.presentation && p.presentation.toLowerCase().includes(q)) ||
                    (p.category_name && p.category_name.toLowerCase().includes(q))
                );
            }
            return list;
        },

        addToCart(product) {
            if (!product) return;
            const availableStock = product.stock !== undefined ? product.stock : 10;
            if (availableStock <= 0) {
                this.showToast(`"${product.name}" no tiene stock disponible`, "error");
                return;
            }

            const existingIndex = this.cart.findIndex(it => it.product_id === product.id);
            if (existingIndex !== -1) {
                const item = this.cart[existingIndex];
                if (item.quantity + 1 > availableStock) {
                    this.showToast(`Solo quedan ${availableStock} unidades de "${product.name}"`, "error");
                    return;
                }
                item.quantity += 1;
                item.subtotal = item.quantity * item.unit_price;
                this.showToast(`+1 ${product.name} (Total: ${item.quantity})`, "info");
            } else {
                const priceType = this.salesPriceType;
                const unitPrice = priceType === 'mayorista' ? product.price_mayorista : product.price_minorista;
                this.cart.push({
                    product_id: product.id,
                    name: product.name,
                    presentation: product.presentation || '',
                    image_path: product.image_path || '',
                    category_name: product.category_name || '',
                    price_minorista: product.price_minorista,
                    price_mayorista: product.price_mayorista,
                    price_type: priceType,
                    unit_price: unitPrice,
                    quantity: 1,
                    stock: availableStock,
                    subtotal: unitPrice
                });
                this.showToast(`Agregado: ${product.name}`, "success");
            }
        },

        removeFromCart(index) {
            if (index >= 0 && index < this.cart.length) {
                const removed = this.cart.splice(index, 1);
                if (removed.length) {
                    this.showToast(`Eliminado del ticket: ${removed[0].name}`, "info");
                }
            }
        },

        updateCartQty(index, delta) {
            const item = this.cart[index];
            if (!item) return;
            const newQty = item.quantity + delta;
            if (newQty <= 0) {
                this.removeFromCart(index);
                return;
            }
            if (newQty > item.stock) {
                this.showToast(`Stock máximo disponible: ${item.stock}`, "error");
                return;
            }
            item.quantity = newQty;
            item.subtotal = item.quantity * item.unit_price;
        },

        setCartItemQty(index, value) {
            const item = this.cart[index];
            if (!item) return;
            let val = parseInt(value) || 1;
            if (val <= 0) val = 1;
            if (val > item.stock) {
                val = item.stock;
                this.showToast(`Ajustado al stock máximo disponible: ${item.stock}`, "info");
            }
            item.quantity = val;
            item.subtotal = item.quantity * item.unit_price;
        },

        toggleCartItemPriceType(index) {
            const item = this.cart[index];
            if (!item) return;
            if (item.price_type === 'minorista') {
                item.price_type = 'mayorista';
                item.unit_price = item.price_mayorista;
            } else {
                item.price_type = 'minorista';
                item.unit_price = item.price_minorista;
            }
            item.subtotal = item.quantity * item.unit_price;
        },

        setAllCartPriceType(type) {
            this.salesPriceType = type;
            this.cart.forEach(item => {
                item.price_type = type;
                item.unit_price = type === 'mayorista' ? item.price_mayorista : item.price_minorista;
                item.subtotal = item.quantity * item.unit_price;
            });
        },

        clearCart() {
            this.cart = [];
            this.saleNotes = '';
            this.cashReceived = '';
        },

        async submitSale() {
            if (this.cart.length === 0) {
                this.showToast("Agrega al menos un producto para registrar la venta", "error");
                return;
            }

            const seller = (this.sellerName || '').trim() || 'General';
            localStorage.setItem('pos_seller_name', seller);
            this.sellerName = seller;

            const paid = parseFloat(this.cashReceived) || 0;
            if (this.paymentMethod === 'Efectivo' && paid > 0 && paid < this.cartTotal) {
                this.showToast(`El dinero abonado (${this.formatCurrency(paid)}) es menor al total (${this.formatCurrency(this.cartTotal)})`, "error");
                return;
            }
            const change = (this.paymentMethod === 'Efectivo' && paid >= this.cartTotal) ? (paid - this.cartTotal) : 0;

            this.isSubmittingSale = true;
            try {
                const payload = {
                    seller_name: seller,
                    price_type: this.salesPriceType,
                    payment_method: this.paymentMethod,
                    notes: this.saleNotes,
                    subtotal_amount: this.cartSubtotal,
                    surcharge_pct: this.paymentSurchargePct,
                    surcharge_amount: this.cartSurchargeAmount,
                    total_amount: this.cartTotal,
                    total_items: this.cartTotalItems,
                    amount_paid: this.paymentMethod === 'Efectivo' ? paid : 0,
                    change_given: this.paymentMethod === 'Efectivo' ? change : 0,
                    items: this.cart.map(it => ({
                        product_id: it.product_id,
                        product_name: it.name,
                        presentation: it.presentation,
                        price_type: it.price_type,
                        unit_price: it.unit_price,
                        quantity: it.quantity,
                        subtotal: it.subtotal
                    }))
                };

                const res = await fetch('/api/sales', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (!res.ok) {
                    this.showToast(data.error || "Error al registrar la venta", "error");
                    return;
                }

                // Actualizar stock en tiempo real en la lista de productos
                if (data.updated_products && Array.isArray(data.updated_products)) {
                    data.updated_products.forEach(up => {
                        const local = this.products.find(p => p.id === up.id);
                        if (local) local.stock = up.stock;
                        const localAll = this.allProducts.find(p => p.id === up.id);
                        if (localAll) localAll.stock = up.stock;
                    });
                }

                this.lastCompletedSale = data.sale;
                this.showSaleSuccessModal = true;
                this.clearCart();
                this.cashReceived = '';
                this.showToast("¡Venta registrada y stock descontado con éxito!", "success");

                // Actualizar resumen e historial
                await this.fetchSalesSummary(this.salesDateFilter || null);
                await this.fetchSales();
            } catch (err) {
                console.error("Error en submitSale:", err);
                this.showToast("Error de conexión al registrar la venta", "error");
            } finally {
                this.isSubmittingSale = false;
            }
        },

        async fetchSales() {
            try {
                let url = '/api/sales?';
                if (this.salesDateFilter) {
                    url += `date=${encodeURIComponent(this.salesDateFilter)}&`;
                }
                const queryTerm = (this.salesSearchQuery || this.salesSellerFilter || '').trim();
                if (queryTerm) {
                    url += `q=${encodeURIComponent(queryTerm)}&`;
                }
                const res = await fetch(url);
                const data = await res.json();
                if (data.success) {
                    this.salesHistory = data.sales;
                    this.$nextTick(() => { if (window.lucide) lucide.createIcons(); });
                }
                await this.fetchSalesSummary(this.salesDateFilter || null);
            } catch (err) {
                console.error("Error al cargar historial de ventas:", err);
            }
        },

        async fetchSalesSummary(date = null) {
            try {
                let url = '/api/sales/summary?';
                if (date) {
                    url += `date=${encodeURIComponent(date)}&`;
                }
                if (this.selectedProfitMonth) {
                    url += `month=${encodeURIComponent(this.selectedProfitMonth)}&`;
                }
                const res = await fetch(url);
                const data = await res.json();
                if (data.success) {
                    this.salesSummary = data.summary;
                }
            } catch (err) {
                console.error("Error al cargar resumen de ventas:", err);
            }
        },

        async fetchProfitBreakdown() {
            this.isLoadingProfit = true;
            try {
                let url = `/api/sales/profit-breakdown?period=${this.profitPeriod}`;
                if (this.profitPeriod === 'custom_month' && this.selectedProfitMonth) {
                    url += `&month=${encodeURIComponent(this.selectedProfitMonth)}`;
                } else if (this.profitPeriod === 'custom_date' && this.selectedProfitDate) {
                    url += `&date=${encodeURIComponent(this.selectedProfitDate)}`;
                }
                const res = await fetch(url);
                const data = await res.json();
                if (data.success) {
                    this.profitBreakdown = data.breakdown;
                }
            } catch (err) {
                console.error("Error al cargar balance de utilidades:", err);
            } finally {
                this.isLoadingProfit = false;
            }
        },

        setProfitPeriod(period) {
            this.profitPeriod = period;
            this.fetchProfitBreakdown();
        },

        async viewSaleDetail(saleId) {
            try {
                const res = await fetch(`/api/sales/${saleId}`);
                const data = await res.json();
                if (data.success) {
                    this.selectedSaleDetail = data.sale;
                    this.showSaleDetailModal = true;
                    this.$nextTick(() => { if (window.lucide) lucide.createIcons(); });
                } else {
                    this.showToast("No se pudo obtener el detalle de la venta", "error");
                }
            } catch (err) {
                this.showToast("Error de red al consultar venta", "error");
            }
        },

        // Helper para imprimir contenido HTML mediante un iframe oculto sin alterar la pantalla
        printHtmlViaIframe(htmlContent) {
            let iframe = document.getElementById('printTicketIframe');
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = 'printTicketIframe';
                iframe.style.position = 'fixed';
                iframe.style.right = '0';
                iframe.style.bottom = '0';
                iframe.style.width = '0';
                iframe.style.height = '0';
                iframe.style.border = '0';
                document.body.appendChild(iframe);
            }
            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(htmlContent);
            doc.close();

            setTimeout(() => {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            }, 300);
        },

        // Carga la venta si no tiene ítems y lanza la impresión del ticket para el cliente
        async printCustomerTicketById(saleId) {
            if (!saleId) return;
            let sale = null;
            if (this.selectedSaleDetail && this.selectedSaleDetail.id === saleId && this.selectedSaleDetail.items && this.selectedSaleDetail.items.length > 0) {
                sale = this.selectedSaleDetail;
            } else if (this.lastCompletedSale && this.lastCompletedSale.id === saleId && this.lastCompletedSale.items && this.lastCompletedSale.items.length > 0) {
                sale = this.lastCompletedSale;
            } else {
                try {
                    const res = await fetch(`/api/sales/${saleId}`);
                    const data = await res.json();
                    if (data.success && data.sale) {
                        sale = data.sale;
                    }
                } catch (e) {
                    console.error("Error al obtener venta para ticket cliente:", e);
                }
            }

            if (!sale) {
                this.showToast("No se pudo cargar la venta para imprimir el ticket", "error");
                return;
            }

            this.printCustomerTicket(sale);
        },

        // Genera e imprime el ticket para entregar al cliente (sin costos, sin ganancias ni márgenes)
        printCustomerTicket(sale) {
            if (!sale) return;
            if (!sale.items || sale.items.length === 0) {
                this.printCustomerTicketById(sale.id);
                return;
            }

            const businessName = (this.settings.business_name || 'BEBIDAS 25 DE MAYO').toUpperCase();
            const bannerPhrase = this.settings.banner_phrase || 'PARA TU NEGOCIO Y PARA VOS';
            const address = this.settings.address || 'Av. 25 de Mayo 343';
            const whatsapp = this.settings.whatsapp_number || '+54 9 11 7626 5350';
            const ticketId = '#' + String(sale.id).padStart(4, '0');
            const dateStr = sale.created_at_local || sale.created_at || new Date().toLocaleString('es-AR');
            const seller = sale.seller_name || 'Caja';
            const modality = (sale.price_type || 'minorista').toUpperCase();
            const paymentMethod = sale.payment_method || 'Efectivo';

            let itemsRows = '';
            (sale.items || []).forEach(item => {
                const qty = item.quantity || 1;
                const unitPriceFormatted = this.formatCurrency(item.unit_price);
                const subtotalFormatted = this.formatCurrency(item.subtotal || (item.unit_price * qty));
                const pres = item.presentation ? ` (${item.presentation})` : '';

                let qtyDetail = '';
                if (qty > 1) {
                    qtyDetail = `<div style="font-size: 11px; color: #222; margin-top: 1px;">${qty} un. x ${unitPriceFormatted}</div>`;
                } else {
                    qtyDetail = `<div style="font-size: 11px; color: #222; margin-top: 1px;">1 un. x ${unitPriceFormatted}</div>`;
                }

                itemsRows += `
                    <tr style="border-bottom: 1px dashed #ccc;">
                        <td style="padding: 5px 0 4px 0; text-align: left; vertical-align: top;">
                            <div style="font-weight: bold; font-size: 11.5px; color: #000; text-transform: uppercase;">${item.product_name}${pres}</div>
                            ${qtyDetail}
                        </td>
                        <td style="padding: 5px 0 4px 0; text-align: right; vertical-align: bottom; font-weight: bold; font-size: 12px; white-space: nowrap;">
                            ${subtotalFormatted}
                        </td>
                    </tr>
                `;
            });

            // Desglose de totales
            let financialRows = '';
            const subtotalAmt = Number(sale.subtotal_amount || (sale.total_amount - (sale.surcharge_amount || 0)));
            if (sale.surcharge_amount && Number(sale.surcharge_amount) > 0) {
                financialRows += `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                        <span>Subtotal productos:</span>
                        <span>${this.formatCurrency(subtotalAmt)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
                        <span>Recargo ${paymentMethod} (+${sale.surcharge_pct || 0}%):</span>
                        <span>+${this.formatCurrency(sale.surcharge_amount)}</span>
                    </div>
                `;
            }

            let cashDetails = '';
            if (sale.payment_method === 'Efectivo' && Number(sale.amount_paid) > 0) {
                cashDetails = `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 3px;">
                        <span>Abonó con efectivo:</span>
                        <span style="font-weight: bold;">${this.formatCurrency(sale.amount_paid)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 11.5px; font-weight: bold; margin-top: 2px;">
                        <span>Su vuelto:</span>
                        <span>${this.formatCurrency(sale.change_given || 0)}</span>
                    </div>
                `;
            }

            const ticketHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Ticket ${ticketId} - ${businessName}</title>
    <style>
        @page {
            size: 80mm auto;
            margin: 3mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 12px;
            color: #000000;
            background: #ffffff;
            width: 72mm;
            margin: 0 auto;
            padding: 4px;
            line-height: 1.3;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .left { text-align: left; }
        .bold { font-weight: bold; }
        .divider { border-top: 1px dashed #000; margin: 6px 0; }
        .divider-solid { border-top: 2px solid #000; margin: 6px 0; }
    </style>
</head>
<body>
    <div class="center" style="margin-bottom: 6px;">
        <h1 style="font-size: 15.5px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">${businessName}</h1>
        <p style="font-size: 10px; margin-top: 1px; text-transform: uppercase;">${bannerPhrase}</p>
        <p style="font-size: 9.5px; margin-top: 1px;">${address} · WhatsApp: ${whatsapp}</p>
    </div>

    <div class="divider"></div>

    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
        <span>TICKET: <strong>${ticketId}</strong></span>
        <span>${dateStr}</span>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
        <span>ATENDIÓ: <strong>${seller}</strong></span>
        <span>PAGO: <strong>${paymentMethod}</strong></span>
    </div>

    <div style="border: 2px solid #000; padding: 4px; text-align: center; font-weight: 900; font-size: 12px; margin: 5px 0; letter-spacing: 0.5px;">
        MODALIDAD: VENTA ${modality}
    </div>

    <div class="divider"></div>

    <table style="width: 100%; border-collapse: collapse; margin-top: 4px;">
        <thead>
            <tr style="border-bottom: 1px dashed #000;">
                <th style="text-align: left; font-size: 10px; padding-bottom: 3px;">DESCRIPCIÓN</th>
                <th style="text-align: right; font-size: 10px; padding-bottom: 3px;">TOTAL</th>
            </tr>
        </thead>
        <tbody>
            ${itemsRows}
        </tbody>
    </table>

    <div class="divider"></div>

    <div style="margin-top: 4px;">
        ${financialRows}
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 900; padding: 4px 0; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; margin: 4px 0;">
            <span>TOTAL COBRADO:</span>
            <span>${this.formatCurrency(sale.total_amount)}</span>
        </div>
        ${cashDetails}
    </div>

    <div class="divider-solid"></div>

    <div class="center" style="margin-top: 8px; font-size: 10px;">
        <div style="font-size: 11.5px; font-weight: bold; margin-bottom: 2px;">¡MUCHAS GRACIAS POR SU COMPRA!</div>
        <div style="font-size: 9px; color: #444;">Comprobante no válido como factura fiscal</div>
        <div style="font-weight: bold; margin-top: 2px;">BEBIDAS 25 DE MAYO</div>
    </div>
</body>
</html>
            `;

            this.printHtmlViaIframe(ticketHtml);
        },

        // Carga la venta si no tiene ítems y lanza la impresión interna completa (para administración)
        async printInternalSaleDetailById(saleId) {
            if (!saleId) return;
            let sale = null;
            if (this.selectedSaleDetail && this.selectedSaleDetail.id === saleId && this.selectedSaleDetail.items && this.selectedSaleDetail.items.length > 0) {
                sale = this.selectedSaleDetail;
            } else {
                try {
                    const res = await fetch(`/api/sales/${saleId}`);
                    const data = await res.json();
                    if (data.success && data.sale) {
                        sale = data.sale;
                    }
                } catch (e) {
                    console.error("Error al obtener venta para detalle interno:", e);
                }
            }

            if (!sale) {
                this.showToast("No se pudo cargar el detalle para imprimir", "error");
                return;
            }

            this.printInternalSaleDetail(sale);
        },

        // Imprime el detalle completo de uso interno (con costos de mercadería, utilidades y ganancia neta)
        printInternalSaleDetail(sale) {
            if (!sale) return;
            if (!sale.items || sale.items.length === 0) {
                this.printInternalSaleDetailById(sale.id);
                return;
            }

            const businessName = (this.settings.business_name || 'BEBIDAS 25 DE MAYO').toUpperCase();
            const ticketId = '#' + String(sale.id).padStart(4, '0');
            const dateStr = sale.created_at_local || sale.created_at || new Date().toLocaleString('es-AR');
            const seller = sale.seller_name || 'Caja';
            const modality = (sale.price_type || 'minorista').toUpperCase();
            const paymentMethod = sale.payment_method || 'Efectivo';

            let itemsTableRows = '';
            (sale.items || []).forEach(item => {
                const cost = Number(item.cost_price || item.catalog_cost_price || 0);
                const unitProfit = item.unit_price - cost;
                const totalProfit = item.profit !== undefined ? item.profit : (unitProfit * item.quantity);
                const pres = item.presentation ? ` (${item.presentation})` : '';

                itemsTableRows += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 5px 6px; font-weight: bold; font-size: 11px;">${item.product_name}${pres}</td>
                        <td style="padding: 5px 6px; text-align: center; text-transform: uppercase; font-size: 10px;">${item.price_type || modality}</td>
                        <td style="padding: 5px 6px; text-align: right; font-family: monospace; font-size: 11px;">${this.formatCurrency(cost)}</td>
                        <td style="padding: 5px 6px; text-align: right; font-family: monospace; font-weight: bold; font-size: 11px;">${this.formatCurrency(item.unit_price)}</td>
                        <td style="padding: 5px 6px; text-align: center; font-weight: bold; font-size: 11px;">${item.quantity}</td>
                        <td style="padding: 5px 6px; text-align: right; font-family: monospace; color: #059669; font-weight: bold; font-size: 11px;">${this.formatCurrency(unitProfit)}</td>
                        <td style="padding: 5px 6px; text-align: right; font-family: monospace; font-weight: bold; font-size: 11px;">${this.formatCurrency(item.subtotal)}</td>
                        <td style="padding: 5px 6px; text-align: right; font-family: monospace; color: #059669; font-weight: 900; font-size: 11px;">${this.formatCurrency(totalProfit)}</td>
                    </tr>
                `;
            });

            const marginPct = sale.total_amount > 0 
                ? (Math.round(((sale.total_profit || 0) / sale.total_amount) * 1000) / 10) + '%' 
                : '0%';
            const netProfit = sale.total_profit || (sale.total_amount - (sale.total_cost || 0));

            const internalHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Reporte Interno ${ticketId} - ${businessName}</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 10mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11.5px;
            color: #1e293b;
            background: #ffffff;
            padding: 10px;
            line-height: 1.35;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th {
            background: #f1f5f9;
            color: #475569;
            font-size: 10px;
            padding: 6px;
            text-transform: uppercase;
            border-bottom: 2px solid #cbd5e1;
        }
    </style>
</head>
<body>
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px;">
        <div>
            <h1 style="font-size: 17px; font-weight: 900; color: #0f172a;">${businessName}</h1>
            <p style="font-size: 11.5px; font-weight: bold; color: #b91c1c; text-transform: uppercase; margin-top: 2px;">DETALLE DE VENTA COMPLETO (USO INTERNO / ADMINISTRATIVO)</p>
        </div>
        <div style="text-align: right;">
            <div style="font-size: 18px; font-weight: 900; font-family: monospace; color: #b91c1c;">${ticketId}</div>
            <div style="font-size: 11px; color: #64748b;">${dateStr}</div>
        </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px;">
        <div><span style="color: #64748b; display: block; font-size: 9.5px; font-weight: bold;">VENDEDOR:</span><strong>${seller}</strong></div>
        <div><span style="color: #64748b; display: block; font-size: 9.5px; font-weight: bold;">MEDIO DE PAGO:</span><strong>${paymentMethod}</strong></div>
        <div><span style="color: #64748b; display: block; font-size: 9.5px; font-weight: bold;">MODALIDAD:</span><strong style="text-transform: uppercase;">${modality}</strong></div>
        <div><span style="color: #64748b; display: block; font-size: 9.5px; font-weight: bold;">ESTADO:</span><strong style="text-transform: uppercase;">${sale.status || 'Completada'}</strong></div>
    </div>

    <table style="margin-bottom: 14px;">
        <thead>
            <tr>
                <th style="text-align: left;">Producto</th>
                <th style="text-align: center;">Modalidad</th>
                <th style="text-align: right;">Costo Unit.</th>
                <th style="text-align: right;">Precio Venta</th>
                <th style="text-align: center;">Cant.</th>
                <th style="text-align: right;">Utilidad Unit.</th>
                <th style="text-align: right;">Subtotal</th>
                <th style="text-align: right;">Ganancia Total</th>
            </tr>
        </thead>
        <tbody>
            ${itemsTableRows}
        </tbody>
    </table>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; font-size: 11.5px; background: #f8fafc;">
            <div style="font-weight: bold; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px; color: #334155;">DESGLOSE DE COBRO</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span>Subtotal productos:</span>
                <span style="font-family: monospace; font-weight: bold;">${this.formatCurrency(sale.subtotal_amount || (sale.total_amount - (sale.surcharge_amount || 0)))}</span>
            </div>
            ${sale.surcharge_amount > 0 ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px; color: #b45309;">
                <span>Recargo ${paymentMethod} (+${sale.surcharge_pct}%):</span>
                <span style="font-family: monospace; font-weight: bold;">+${this.formatCurrency(sale.surcharge_amount)}</span>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between; font-size: 13.5px; font-weight: 900; border-top: 1px solid #cbd5e1; padding-top: 5px; margin-top: 4px;">
                <span>TOTAL COBRADO:</span>
                <span style="font-family: monospace;">${this.formatCurrency(sale.total_amount)}</span>
            </div>
            ${sale.payment_method === 'Efectivo' && sale.amount_paid > 0 ? `
            <div style="margin-top: 6px; padding-top: 5px; border-top: 1px dashed #cbd5e1; font-size: 11px;">
                <div style="display: flex; justify-content: space-between;"><span>Abonó con efectivo:</span><span style="font-family: monospace; font-weight: bold;">${this.formatCurrency(sale.amount_paid)}</span></div>
                <div style="display: flex; justify-content: space-between; font-weight: bold; color: #059669; margin-top: 2px;"><span>Vuelto entregado:</span><span style="font-family: monospace;">${this.formatCurrency(sale.change_given || 0)}</span></div>
            </div>` : ''}
        </div>

        <div style="border: 1px solid #86efac; border-radius: 6px; padding: 10px; font-size: 11.5px; background: #f0fdf4;">
            <div style="font-weight: bold; border-bottom: 1px solid #86efac; padding-bottom: 4px; margin-bottom: 6px; color: #166534;">RENTABILIDAD Y UTILIDAD (ADMINISTRACIÓN)</div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span>Costo Total Mercadería:</span>
                <span style="font-family: monospace; font-weight: bold;">${this.formatCurrency(sale.total_cost || 0)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span>Margen de Ganancia:</span>
                <span style="font-family: monospace; font-weight: bold; color: #15803d;">${marginPct}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 14.5px; font-weight: 900; border-top: 1.5px solid #86efac; padding-top: 5px; margin-top: 5px; color: #166534;">
                <span>GANANCIA NETA:</span>
                <span style="font-family: monospace;">${this.formatCurrency(netProfit)}</span>
            </div>
        </div>
    </div>
</body>
</html>
            `;

            this.printHtmlViaIframe(internalHtml);
        },

        getDetailPaymentSurchargePct(method) {
            if (method === 'Tarjeta de Débito') return 2;
            if (method === 'Tarjeta de Crédito') return 7;
            if (method === 'QR mercadopago') return 1;
            return 0;
        },

        onDetailPaymentMethodChange() {
            if (!this.selectedSaleDetail) return;
            const pct = this.getDetailPaymentSurchargePct(this.selectedSaleDetail.payment_method);
            const subtotal = Number(this.selectedSaleDetail.subtotal_amount || 0);
            const surchargeAmt = pct > 0 ? Math.round(subtotal * (pct / 100)) : 0;
            
            this.selectedSaleDetail.surcharge_pct = pct;
            this.selectedSaleDetail.surcharge_amount = surchargeAmt;
            this.selectedSaleDetail.total_amount = subtotal + surchargeAmt;
            const cost = Number(this.selectedSaleDetail.total_cost || 0);
            this.selectedSaleDetail.total_profit = Math.round((this.selectedSaleDetail.total_amount - cost) * 100) / 100;
        },

        onDetailPriceTypeChange() {
            if (!this.selectedSaleDetail) return;
            const newType = this.selectedSaleDetail.price_type;
            let subtotalAcc = 0;
            let totalCostAcc = 0;

            (this.selectedSaleDetail.items || []).forEach(item => {
                item.price_type = newType;
                if (newType === 'mayorista') {
                    item.unit_price = (item.catalog_price_mayorista !== undefined && item.catalog_price_mayorista > 0)
                        ? item.catalog_price_mayorista 
                        : item.unit_price;
                } else {
                    item.unit_price = (item.catalog_price_minorista !== undefined && item.catalog_price_minorista > 0)
                        ? item.catalog_price_minorista 
                        : item.unit_price;
                }
                const cost = Number(item.cost_price || item.catalog_cost_price || 0);
                item.subtotal = item.unit_price * item.quantity;
                item.profit = (item.unit_price - cost) * item.quantity;
                subtotalAcc += item.subtotal;
                totalCostAcc += (cost * item.quantity);
            });

            this.selectedSaleDetail.subtotal_amount = subtotalAcc;
            this.selectedSaleDetail.total_cost = totalCostAcc;
            this.onDetailPaymentMethodChange();
        },

        async saveSaleDetailChanges() {
            if (!this.selectedSaleDetail) return;
            this.isSavingSaleDetail = true;
            try {
                const payload = {
                    payment_method: this.selectedSaleDetail.payment_method,
                    price_type: this.selectedSaleDetail.price_type,
                    seller_name: this.selectedSaleDetail.seller_name,
                    notes: this.selectedSaleDetail.notes || ''
                };
                const res = await fetch(`/api/sales/${this.selectedSaleDetail.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    this.selectedSaleDetail = data.sale;
                    this.showToast("¡Venta actualizada y recalculada con éxito!", "success");
                    await this.fetchSales();
                    await this.fetchSalesSummary(this.salesDateFilter || null);
                    await this.fetchProfitBreakdown();
                } else {
                    this.showToast(data.error || "No se pudo actualizar la venta", "error");
                }
            } catch (err) {
                console.error("Error al guardar cambios de venta:", err);
                this.showToast("Error de conexión al guardar cambios", "error");
            } finally {
                this.isSavingSaleDetail = false;
            }
        },

        async cancelSale(saleId) {
            if (!confirm("¿Estás seguro de anular esta venta? El stock de los productos será reintegrado automáticamente a la base de datos.")) {
                return;
            }
            try {
                const res = await fetch(`/api/sales/${saleId}/cancel`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    this.showToast(data.message, "success");
                    if (data.updated_products && Array.isArray(data.updated_products)) {
                        data.updated_products.forEach(up => {
                            const local = this.products.find(p => p.id === up.id);
                            if (local) local.stock = up.stock;
                            const localAll = this.allProducts.find(p => p.id === up.id);
                            if (localAll) localAll.stock = up.stock;
                        });
                    }
                    if (this.selectedSaleDetail && this.selectedSaleDetail.id === saleId) {
                        this.selectedSaleDetail.status = 'cancelled';
                    }
                    await this.fetchSales();
                    await this.fetchSalesSummary();
                    await this.fetchProfitBreakdown();
                } else {
                    this.showToast(data.error || "No se pudo anular la venta", "error");
                }
            } catch (err) {
                this.showToast("Error de red al anular venta", "error");
            }
        },

        // =========================================================
        // MÉTODOS DE SINCRONIZACIÓN LOCAL <-> NUBE (WEB)
        // =========================================================
        async silentSync() {
            if (this.isSyncing) return;
            try {
                const res = await fetch('/api/sync/trigger', { method: 'POST' });
                const data = await res.json();
                if (data.success && (data.imported_sales > 0 || data.updated_products > 0)) {
                    this.lastSyncTime = data.timestamp;
                    this.syncState = 'synced';
                    localStorage.setItem('last_sync_time', data.timestamp);
                    await this.fetchProducts();
                    await this.fetchSales();
                    await this.fetchSalesSummary();
                    await this.fetchProfitBreakdown();
                    if (data.imported_sales > 0) {
                        this.showToast(`Se descargaron ${data.imported_sales} ventas nuevas desde la web online`, "info");
                    }
                }
            } catch (e) {
                // Silencioso
            }
        },

        async syncWithWeb() {
            if (this.isSyncing) return;
            this.isSyncing = true;
            this.syncState = 'syncing';
            this.showToast("Iniciando sincronización con el servidor web...", "info");

            try {
                const res = await fetch('/api/sync/trigger', { method: 'POST' });
                const data = await res.json();
                
                if (res.ok && data.success) {
                    this.lastSyncTime = data.timestamp;
                    this.syncState = 'synced';
                    localStorage.setItem('last_sync_time', data.timestamp);
                    this.showToast(`¡Sincronizado! ${data.imported_sales || 0} ventas y ${data.updated_products || 0} productos actualizados en la web.`, "success");
                    await this.fetchProducts();
                    await this.fetchSales();
                    await this.fetchSalesSummary();
                } else {
                    this.syncState = 'error';
                    this.showToast(data.error || "No se pudo sincronizar con el servidor web", "error");
                }
            } catch (err) {
                console.error("Error en syncWithWeb:", err);
                this.syncState = 'error';
                this.showToast("Error de conexión al sincronizar con la web online", "error");
            } finally {
                this.isSyncing = false;
                this.$nextTick(() => {
                    if (window.lucide) lucide.createIcons();
                });
            }
        },

        async uploadFullDatabaseToWeb() {
            if (this.isSyncing) return;
            if (!confirm("¿Deseas enviar una copia COMPLETA de tu base local a la web online? Esto actualizará todos los productos, precios, costos y ventas de la web.")) {
                return;
            }

            this.isSyncing = true;
            this.syncState = 'syncing';
            this.showToast("Transfiriendo base de datos completa a la web...", "info");

            try {
                const res = await fetch('/api/sync/trigger-full-upload', { method: 'POST' });
                const data = await res.json();
                
                if (res.ok && data.success) {
                    this.lastSyncTime = data.timestamp;
                    this.syncState = 'synced';
                    localStorage.setItem('last_sync_time', data.timestamp);
                    this.showToast(data.message, "success");
                } else {
                    this.syncState = 'error';
                    this.showToast(data.error || "Error al transferir base completa a la web", "error");
                }
            } catch (err) {
                console.error("Error en uploadFullDatabaseToWeb:", err);
                this.syncState = 'error';
                this.showToast("Error de red al transferir base a la web online", "error");
            } finally {
                this.isSyncing = false;
                this.$nextTick(() => {
                    if (window.lucide) lucide.createIcons();
                });
            }
        }
    }));
});
