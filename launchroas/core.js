(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.LaunchRoasCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function kstToday(now){
    var parts = {};
    new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'})
      .formatToParts(new Date(now)).forEach(function(p){ parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  function kstStartIso(now){
    return new Date(kstToday(now) + 'T00:00:00+09:00').toISOString();
  }
  function summarizeOrders(rows){
    return (rows || []).reduce(function(out, row){
      out.count += 1;
      out.amount += Number(row.payment_amount) || 0;
      return out;
    }, {count:0, amount:0});
  }
  function hasTodayCoverage(lastSync, now){
    var ms = Date.parse(lastSync || '');
    return Number.isFinite(ms) && ms >= Date.parse(kstStartIso(now));
  }
  return {kstToday:kstToday, kstStartIso:kstStartIso, summarizeOrders:summarizeOrders, hasTodayCoverage:hasTodayCoverage};
});
