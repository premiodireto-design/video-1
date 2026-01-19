import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Filter, ArrowUpDown, X } from 'lucide-react';
import type { VideoFilters, SortBy, SortOrder } from '@/types/analyser';

interface FiltersSectionProps {
  filters: VideoFilters;
  onFiltersChange: (filters: VideoFilters) => void;
  sortBy: SortBy;
  sortOrder: SortOrder;
  onSortChange: (sortBy: SortBy, sortOrder: SortOrder) => void;
}

export function FiltersSection({ 
  filters, 
  onFiltersChange, 
  sortBy, 
  sortOrder, 
  onSortChange 
}: FiltersSectionProps) {
  const clearFilters = () => {
    onFiltersChange({
      searchText: '',
      dateFrom: '',
      dateTo: '',
      minViews: 0,
      minLikes: 0,
      minComments: 0,
    });
  };

  const hasActiveFilters = 
    filters.searchText || 
    filters.dateFrom || 
    filters.dateTo || 
    filters.minViews > 0 || 
    filters.minLikes > 0 || 
    filters.minComments > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros e Ordenação
          </CardTitle>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" />
              Limpar filtros
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sorting */}
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3" />
              Ordenar por
            </Label>
            <Select 
              value={sortBy} 
              onValueChange={(v) => onSortChange(v as SortBy, sortOrder)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="likes">Curtidas</SelectItem>
                <SelectItem value="views">Visualizações</SelectItem>
                <SelectItem value="comments">Comentários</SelectItem>
                <SelectItem value="date">Data</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Ordem</Label>
            <Select 
              value={sortOrder} 
              onValueChange={(v) => onSortChange(sortBy, v as SortOrder)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Maior para menor</SelectItem>
                <SelectItem value="asc">Menor para maior</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="col-span-2 space-y-2">
            <Label>Buscar na legenda</Label>
            <Input 
              placeholder="Buscar texto..."
              value={filters.searchText}
              onChange={(e) => onFiltersChange({ ...filters, searchText: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Data início</Label>
            <Input 
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Data fim</Label>
            <Input 
              type="date"
              value={filters.dateTo}
              onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Mín. Views</Label>
            <Input 
              type="number"
              min={0}
              placeholder="0"
              value={filters.minViews || ''}
              onChange={(e) => onFiltersChange({ ...filters, minViews: parseInt(e.target.value) || 0 })}
            />
          </div>

          <div className="space-y-2">
            <Label>Mín. Curtidas</Label>
            <Input 
              type="number"
              min={0}
              placeholder="0"
              value={filters.minLikes || ''}
              onChange={(e) => onFiltersChange({ ...filters, minLikes: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
