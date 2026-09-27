(function(){
  var view = document.getElementById('view-couriers');
  if(!view) return;
  var grid = document.getElementById('courierGrid');
  var buttons = Array.prototype.slice.call(view.querySelectorAll('[data-courier-filter]'));
  var search = document.getElementById('courierSearch');
  var status = document.getElementById('courierResultStatus');
  var empty = document.getElementById('courierNoResults');
  var badge = view.querySelector('.courier-hero-badge');
  var region = 'all';
  var requestSeq = 0;

  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function formatPhone(digits){
    return digits.replace(/^(01\d)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  }
  function render(items){
    grid.innerHTML = items.map(function(item){
      var digits = String(item.phone || '').replace(/\D/g, '');
      if(!/^01\d{8,9}$/.test(digits)) return '';
      var regions = (item.regions || []).filter(function(value){
        return ['seoul','gyeonggi','incheon','other'].indexOf(value) !== -1;
      }).join(' ');
      return '<article class="info-card courier-card" data-courier-regions="' + regions + '">' +
        '<h2>' + escapeHtml(item.name) + ' <span class="tag">' + escapeHtml(item.area_label) + '</span></h2>' +
        '<p>' + escapeHtml(item.description) + '</p>' +
        '<a class="courier-call" href="tel:' + digits + '" aria-label="' + escapeHtml(item.name) + ' ' + formatPhone(digits) + '로 전화하기">' + formatPhone(digits) + ' →</a>' +
      '</article>';
    }).join('');
    badge.textContent = '등록된 상담 연락처 ' + items.length + '곳';
    update();
  }
  function update(){
    var query = search.value.trim().toLocaleLowerCase();
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.courier-card'));
    var visible = 0;
    cards.forEach(function(card){
      var regions = (card.getAttribute('data-courier-regions') || '').split(/\s+/);
      var matched = (region === 'all' || regions.indexOf(region) !== -1)
        && card.textContent.toLocaleLowerCase().indexOf(query) !== -1;
      card.hidden = !matched;
      if(matched) visible++;
    });
    empty.hidden = visible !== 0;
    status.textContent = visible ? '상담 연락처 ' + visible + '곳' : '검색 결과가 없어요';
  }
  function load(){
    var sb = window.launchdeskSupabase;
    if(!sb) return; // Keep the bundled directory visible before DB setup.
    var seq = ++requestSeq;
    grid.hidden = true;
    empty.hidden = true;
    status.textContent = '상담 연락처를 불러오는 중…';
    sb.from('courier_contacts')
      .select('id, name, area_label, regions, description, phone')
      .eq('published', true)
      .order('created_at', { ascending: true })
      .then(function(result){
        if(seq !== requestSeq) return;
        if(result.error){
          // Before the migration, show the bundled entries. Other failures
          // must not redisplay a contact that an admin has unpublished.
          if(result.error.code === '42P01' || result.error.code === 'PGRST205'){
            grid.hidden = false;
            update();
          } else {
            status.textContent = '연락처를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';
          }
          return;
        }
        render(result.data || []);
        grid.hidden = false;
      }).catch(function(){
        if(seq === requestSeq) status.textContent = '연락처를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';
      });
  }

  buttons.forEach(function(button){
    button.addEventListener('click', function(){
      region = button.getAttribute('data-courier-filter');
      buttons.forEach(function(item){ item.setAttribute('aria-pressed', String(item === button)); });
      update();
    });
  });
  search.addEventListener('input', update);
  window.addEventListener('hashchange', function(){ if(location.hash === '#/couriers') load(); });
  window.addEventListener('launchdesk:couriers-changed', load);
  update();
  load();
})();
